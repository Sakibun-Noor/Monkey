/**
 * Web Audio mixer for narration, music, and monkey ambience.
 *
 * The old approach corrected three <audio> elements every frame with seeks and
 * playbackRate nudges. On iOS Safari, rAF throttles harder than desktop/Android,
 * so corrections land less often but much harder -- audible clicks and a
 * "mixed together" quality instead of clean layers.
 *
 * This mixer decodes all three layers into AudioBuffers up front and starts them
 * together via AudioBufferSourceNode.start(when, offset) on the AudioContext's
 * own sample-accurate clock. Nothing about the audio is ever seeked or
 * rate-nudged after that -- the caller instead walks the (muted) video onto the
 * audio clock, since drifting a picture is invisible but drifting audio is not.
 */

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
   * Run `fn` once the context is genuinely producing output. Scheduling sources
   * against a still-suspended context anchors the clock to a frozen currentTime,
   * so the audio would come in late and sit permanently behind the picture.
   */
  whenRunning(fn) {
    if (this.ctx.state === 'running') fn();
    else this.unlock().then(fn);
  }

  addTrack(name, { volume = 1 } = {}) {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    this.tracks.set(name, {
      buffer: null, duration: 0, gain, source: null,
      baseVolume: volume, scale: 1, enabled: true, playing: false,
    });
  }

  /** Fetch and decode a source into this track's buffer. Missing/broken audio is silent, not fatal. */
  async load(name, src) {
    const track = this.tracks.get(name);
    track.buffer = null;
    try {
      const bytes = await (await fetch(src)).arrayBuffer();
      track.buffer = await this.ctx.decodeAudioData(bytes);
      track.duration = track.buffer.duration;
    } catch (err) {
      track.duration = 0;
      // Silence on one layer is survivable; silence with no explanation is not.
      console.warn(`[mix] "${name}" failed to load, playing without it: ${src}`, err);
    }
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
    for (const [name, track] of this.tracks) this._startTrack(track, t, when);
  }

  _startTrack(track, t, when) {
    this._stopTrack(track);
    if (!track.buffer || t >= track.duration - 0.02) { track.playing = false; return; }
    const source = this.ctx.createBufferSource();
    source.buffer = track.buffer;
    source.connect(track.gain);
    source.start(when, t);
    track.source = source;
    track.playing = true;
    this._applyGain(track, true);
  }

  _stopTrack(track) {
    if (track.source) {
      try { track.source.stop(); } catch { /* already stopped/ended */ }
      try { track.source.disconnect(); } catch { /* already disconnected */ }
      track.source = null;
    }
    track.playing = false;
  }

  stopAll() {
    this.running = false;
    for (const track of this.tracks.values()) this._stopTrack(track);
  }

  /**
   * Reposition during playback. AudioBufferSourceNode can't be seeked in place,
   * so a live reseek is stop-and-restart; while paused this is a no-op because
   * the next play() reads its offset fresh from the video element.
   */
  seek(t) {
    if (this.running) this.startAll(t);
  }

  /** The shared audio clock: elapsed logical time since the last startAll(). */
  now() {
    if (!this.running) return this.anchorOffset;
    return this.anchorOffset + (this.ctx.currentTime - this.anchorCtxTime);
  }
}
