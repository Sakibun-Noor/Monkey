/**
 * Comment overlay. Everything here is HTML/CSS on top of the <video>; nothing
 * is ever drawn into the video itself.
 *
 * Rules: at most MAX_VISIBLE on screen, newest at the bottom-left, older rows
 * glide upward and fade out. Timing is driven entirely by the video clock, so
 * pause freezes the stack and scrubbing rebuilds it exactly.
 */

const MAX_VISIBLE = 4;
const LIFETIME = 8.0;   // seconds of video time a comment stays up
const ENTER_MS = 420;
const EXIT_MS = 420;

export class CommentLayer {
  /**
   * @param {HTMLElement} root
   * @param {Array<{id:string,name:string,avatar:string}>} commenters
   * @param {{onPop: () => void}} hooks
   */
  constructor(root, commenters, { onPop } = {}) {
    this.root = root;
    this.people = new Map(commenters.map((c) => [c.id, c]));
    this.onPop = onPop || (() => {});
    this.comments = [];
    this.cursor = 0;
    this.live = [];   // [{ comment, node, shownAt }] oldest first
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Swap in a comment set and clear the screen. */
  setSet(set) {
    this.comments = [...set.comments].sort((a, b) => a.t - b.t);
    this.reset();
  }

  reset() {
    this.cursor = 0;
    this.live = [];
    this.root.replaceChildren();
  }

  /** Advance to `t`, emitting anything newly due. */
  update(t) {
    while (this.cursor < this.comments.length && this.comments[this.cursor].t <= t) {
      this._show(this.comments[this.cursor], t, true);
      this.cursor += 1;
    }
    this._expire(t);
  }

  /**
   * Rebuild the stack for an arbitrary time — used after a seek. Silent: no pop
   * sounds and no entry animation, because these comments did not just arrive.
   */
  rebuildAt(t) {
    this.reset();
    const due = [];
    for (const c of this.comments) {
      if (c.t > t) break;
      this.cursor += 1;
      if (t - c.t < LIFETIME) due.push(c);
    }
    for (const c of due.slice(-MAX_VISIBLE)) this._show(c, t, false);
  }

  _show(comment, t, animate) {
    const node = this._render(comment);
    this.root.appendChild(node);
    this.live.push({ comment, node, shownAt: t });

    const inner = node.firstElementChild;
    const h = inner.offsetHeight;

    if (animate && !this.reduced) {
      // Growing the newest row from zero height pushes older rows up smoothly.
      node.animate(
        [{ height: '0px' }, { height: `${h}px` }],
        { duration: ENTER_MS, easing: 'cubic-bezier(.2,.9,.25,1)' },
      );
      inner.animate(
        [
          { opacity: 0, transform: 'translateY(10px) scale(.9)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: ENTER_MS, easing: 'cubic-bezier(.2,1.25,.4,1)' },
      );
      this.onPop();
    } else if (animate) {
      this.onPop();
    }

    while (this.live.length > MAX_VISIBLE) this._retire(this.live.shift());
  }

  _expire(t) {
    while (this.live.length && t - this.live[0].shownAt >= LIFETIME) {
      this._retire(this.live.shift());
    }
  }

  _retire(entry) {
    if (!entry || !entry.node.isConnected) return;
    const { node } = entry;
    if (this.reduced) {
      node.remove();
      return;
    }
    const h = node.offsetHeight;
    node.animate(
      [
        { height: `${h}px`, opacity: 1, transform: 'none' },
        { height: '0px', opacity: 0, transform: 'translateY(-8px)' },
      ],
      { duration: EXIT_MS, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' },
    );
    // Removal is driven by the timer, not by onfinish: a frozen or cancelled
    // animation must never be able to strand a node on screen.
    setTimeout(() => node.remove(), EXIT_MS);
  }

  _render(comment) {
    const person = this.people.get(comment.who)
      || { name: comment.who, avatar: '' };

    const wrap = document.createElement('div');
    wrap.className = 'comment';

    const inner = document.createElement('div');
    inner.className = 'comment__inner';

    const img = document.createElement('img');
    img.className = 'comment__avatar';
    img.src = person.avatar;
    img.alt = '';
    img.loading = 'eager';
    img.decoding = 'sync';

    const body = document.createElement('div');
    body.className = 'comment__body';

    const name = document.createElement('span');
    name.className = 'comment__name';
    name.textContent = person.name;

    const text = document.createElement('span');
    text.className = 'comment__text';
    text.textContent = comment.text;

    body.append(name, text);
    if (comment.emoji) {
      const em = document.createElement('span');
      em.className = 'comment__emoji';
      em.textContent = comment.emoji;
      text.appendChild(em);
    }

    inner.append(img, body);
    wrap.appendChild(inner);
    return wrap;
  }
}
