/**
 * Web Audio mixer for narration, music, and monkey ambience.
 *
 * The old approach corrected three <audio> elements every frame with seeks and
 * playbackRate nudges. On iOS Safari, rAF throttles harder than desktop/Android,
 * so corrections landed less often but much harder -- audible clicks and a
 * "mixed together" quality instead of clean layers.
 *
 * This mixer decodes every layer into an AudioBuffer up front and starts them
 * together via AudioBufferSourceNode.start(when, offset) on the AudioContext's
 * own sample-accurate clock. Nothing about the audio is ever seeked or
 * rate-nudged after that -- the caller instead walks the (muted) video onto the
 * audio clock, since drifting a picture is invisible but drifting audio is not.
 */

const FADE_IN = 0.012;   // starting mid-waveform without a ramp clicks
const FADE_OUT = 0.04;   // likewise stopping; long enough to be silent, short enough to feel instant

export class Mixer {
  constructor() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.tracks = new Map();
    this.anchorCtxTime = 0;
    this.anchorOffset = 0;
    this.running = false;

    // iOS silences Web Audio with the hardware ring/silent switch unless the page
    // claims a playback session -- an iPhone with that switch flipped otherwise
    // plays the video in total silence, with nothing in the console to show why.
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  }

  /**
   * iOS resumes an AudioContext only from inside a real user gesture, and can
   * interrupt it again later (an incoming call, Siri). Cheap enough to call on
   * every touch rather than once at startup.
   */
  async unlock() {
    if (this.ctx.state === 'running') return;
    try { await this.ctx.resume(); } catch { /* retried on the next gesture */ }
  }

  /**
   * Resolve true once the context is genuinely producing output, or false after
   * `timeoutMs` if it still is not (resume() from outside a gesture just hangs on
   * iOS). Scheduling sources against a suspended context would anchor the clock
   * to a frozen currentTime and leave the audio permanently behind the picture.
   */
  whenRunning(timeoutMs = 1500) {
    if (this.ctx.state === 'running') return Promise.resolve(true);
    return Promise.race([
      this.unlock(),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]).then(() => this.ctx.state === 'running');
  }

  addTrack(name, { volume = 1 } = {}) {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    this.tracks.set(name, {
      buffer: null, duration: 0, gain, source: null, env: null,
      baseVolume: volume, scale: 1, enabled: true, playing: false,
    });
  }

  /** Fetch and decode without touching any track, so the next mix can be warmed in the background. */
  async decode(src) {
    try {
      const bytes = await (await fetch(src)).arrayBuffer();
      return await this.ctx.decodeAudioData(bytes);
    } catch (err) {
      // Silence on one layer is survivable; silence with no explanation is not.
      console.warn(`[mix] failed to load, playing without it: ${src}`, err);
      return null;
    }
  }

  setBuffer(name, buffer) {
    const track = this.tracks.get(name);
    track.buffer = buffer;
    track.duration = buffer ? buffer.duration : 0;
  }

  async load(name, src) {
    this.setBuffer(name, await this.decode(src));
  }

  setScale(name, v) {
    const track = this.tracks.get(name);
    if (!track) return;
    track.scale = Math.max(0, Math.min(1, v));
    this._applyGain(track);
  }

  setEnabled(name, on) {
    const track = this.tracks.get(name);
    if (!track) return;
    track.enabled = on;
    this._applyGain(track);
  }

  // `instant` skips the smoothing ramp so a track starts at full level rather
  // than fading in; every other caller (mute, end-of-video duck) wants the ramp
  // so rapid per-frame gain changes don't zipper.
  _applyGain(track, instant = false) {
    const level = track.enabled ? track.baseVolume * track.scale : 0;
    const now = this.ctx.currentTime;
    track.gain.gain.cancelScheduledValues(now);
    if (instant) track.gain.gain.setValueAtTime(level, now);
    else track.gain.gain.setTargetAtTime(level, now, 0.015);
  }

  /** Start every loaded track together at logical offset `t` (seconds into the mix). */
  startAll(t) {
    const when = this.ctx.currentTime + 0.03; // headroom so scheduling never lands in the past
    this.anchorCtxTime = when;
    this.anchorOffset = t;
    this.running = true;
    for (const track of this.tracks.values()) this._startTrack(track, t, when);
  }

  _startTrack(track, t, when) {
    this._stopTrack(track);
    if (!track.buffer || t >= track.duration - 0.02) return;

    // Each source gets its own envelope so a stopping source can fade out on its
    // own while the replacement fades in on the same track gain.
    const source = this.ctx.createBufferSource();
    const env = this.ctx.createGain();
    source.buffer = track.buffer;
    source.connect(env).connect(track.gain);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(1, when + FADE_IN);
    source.start(when, t);
    source.onended = () => {
      try { source.disconnect(); env.disconnect(); } catch { /* already gone */ }
    };

    track.source = source;
    track.env = env;
    track.playing = true;
    this._applyGain(track, true);
  }

  _stopTrack(track) {
    const { source, env } = track;
    if (source) {
      const now = this.ctx.currentTime;
      try {
        env.gain.cancelScheduledValues(now);
        env.gain.setValueAtTime(env.gain.value, now);
        env.gain.linearRampToValueAtTime(0, now + FADE_OUT);
        source.stop(now + FADE_OUT + 0.005);
      } catch {
        try { source.stop(); } catch { /* already stopped */ }
      }
      track.source = null;
      track.env = null;
    }
    track.playing = false;
  }

  stopAll() {
    this.running = false;
    for (const track of this.tracks.values()) this._stopTrack(track);
  }

  /** The shared audio clock: elapsed logical time since the last startAll(). */
  now() {
    if (!this.running) return this.anchorOffset;
    return this.anchorOffset + (this.ctx.currentTime - this.anchorCtxTime);
  }
}
