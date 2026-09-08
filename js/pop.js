/**
 * Low-latency pop for comment arrivals.
 *
 * WebAudio when available (retriggers cleanly when two comments land in the
 * same second), with an HTMLAudio pool as the fallback.
 */
export class Pop {
  constructor(src, { volume = 0.5, context = null } = {}) {
    this.src = src;
    this.volume = volume;
    // Shares the mixer's context when given one: a second AudioContext is one
    // more thing that has to survive iOS unlocking and interruptions.
    this.ctx = context;
    this.buffer = null;
    this.muted = false;
    this.pool = Array.from({ length: 4 }, () => {
      const a = new Audio(src);
      a.preload = 'auto';
      a.volume = volume;
      return a;
    });
    this.cursor = 0;
  }

  /**
   * Warm the WebAudio path. Called from a user gesture but never awaited by the
   * caller — if the context refuses to resume, the <audio> pool still works.
   */
  async unlock() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx) this.ctx = new Ctx();
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
    }
    if (this.buffer || this._decoding) return;
    this._decoding = true;
    try {
      const bytes = await (await fetch(this.src)).arrayBuffer();
      this.buffer = await this.ctx.decodeAudioData(bytes);
    } catch {
      this.buffer = null; // fall back to the <audio> pool
    }
  }

  play() {
    if (this.muted) return;
    if (this.ctx && this.buffer && this.ctx.state === 'running') {
      const node = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      node.buffer = this.buffer;
      gain.gain.value = this.volume;
      node.connect(gain).connect(this.ctx.destination);
      node.start();
      return;
    }
    const a = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    try {
      a.currentTime = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch { /* ignore */ }
  }

  setMuted(m) {
    this.muted = m;
  }
}
