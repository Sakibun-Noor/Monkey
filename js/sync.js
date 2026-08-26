/**
 * Keeps one <audio> element locked to the video clock.
 *
 * The video is the master timeline and is never touched. Tracks that are
 * shorter than the video simply run out and go quiet for the tail; tracks that
 * are longer are cut off when the video ends. Nothing is time-stretched — the
 * only rate change is a sub-percent nudge used to walk off small drift, which
 * is inaudible and settles back to 1.0.
 */

const HARD_RESYNC = 0.28;  // seconds of drift that warrant a hard seek
const SOFT_DRIFT = 0.045;  // seconds of drift corrected by rate nudging
const MAX_NUDGE = 0.06;    // +/- 6% playback rate, capped
const TAIL_FADE = 0.6;     // fade-out applied as a track reaches its own end
const EDGE = 0.05;

export class TrackSync {
  /** @param {HTMLAudioElement} el @param {{volume:number}} opts */
  constructor(el, { volume = 1 } = {}) {
    this.el = el;
    this.baseVolume = volume;
    this.scale = 1;             // external multiplier, used for the end fade
    this.duration = 0;
    this.ready = false;
    this.enabled = true;
    this._wanted = false;
  }

  /** Multiplier applied on top of the track's mix level (0..1). */
  setScale(v) {
    this.scale = Math.max(0, Math.min(1, v));
  }

  get level() {
    return this.baseVolume * this.scale;
  }

  /** Point at a new source and resolve once it can play through. */
  load(src, duration) {
    this.ready = false;
    this.duration = duration || 0;
    this.el.pause();
    this.el.playbackRate = 1;
    this.el.volume = this.level;
    this.el.src = src;
    this.el.load();

    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.el.removeEventListener('canplaythrough', done);
        this.el.removeEventListener('loadeddata', done);
        this.el.removeEventListener('error', done);
        if (this.el.duration && isFinite(this.el.duration)) this.duration = this.el.duration;
        this.ready = true;
        resolve();
      };
      // loadeddata is enough to start; canplaythrough is the happy path.
      this.el.addEventListener('canplaythrough', done);
      this.el.addEventListener('loadeddata', done);
      this.el.addEventListener('error', done);
      const timer = setTimeout(done, 6000);
    });
  }

  /** Called straight from the user gesture so mobile autoplay policy is satisfied. */
  primeFromGesture(t) {
    if (!this.enabled || this._pastEnd(t)) return;
    this._wanted = true;
    this._seek(t);
    const p = this.el.play();
    if (p && p.catch) p.catch(() => {});
  }

  pause() {
    this._wanted = false;
    this.el.pause();
  }

  /** Jump straight to a new video time (scrubbing). */
  seekTo(t) {
    if (this._pastEnd(t)) {
      this.el.pause();
      return;
    }
    this._seek(t);
  }

  setEnabled(on) {
    this.enabled = on;
    this.el.muted = !on;
  }

  /**
   * Per-frame correction against the master clock.
   * @param {number} t video currentTime
   * @param {boolean} videoPlaying
   */
  update(t, videoPlaying) {
    const el = this.el;

    if (!videoPlaying) {
      this._wanted = false;
      if (!el.paused) el.pause();
      return;
    }

    // Track ran out before the video did: stay silent, do not loop or stretch.
    if (this._pastEnd(t)) {
      if (!el.paused) el.pause();
      el.volume = this.level;
      return;
    }

    if (el.paused && this.ready) {
      this._wanted = true;
      this._seek(t);
      el.volume = this.level;
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
      return;
    }
    if (el.paused) return;

    const drift = el.currentTime - t;
    const mag = Math.abs(drift);

    if (mag > HARD_RESYNC) {
      this._seek(t);
      el.playbackRate = 1;
    } else if (mag > SOFT_DRIFT) {
      // Ahead of the video -> slow down slightly, and vice versa.
      const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, -drift * 0.5));
      el.playbackRate = 1 + nudge;
    } else if (el.playbackRate !== 1) {
      el.playbackRate = 1;
    }

    // Soften the moment a short track hits its own end.
    const left = this.duration - t;
    el.volume = left < TAIL_FADE
      ? this.level * Math.max(0, left / TAIL_FADE)
      : this.level;
  }

  _pastEnd(t) {
    return this.duration > 0 && t >= this.duration - EDGE;
  }

  _seek(t) {
    const target = Math.max(0, Math.min(t, Math.max(0, this.duration - EDGE)));
    if (Math.abs(this.el.currentTime - target) > 0.01) this.el.currentTime = target;
  }
}
