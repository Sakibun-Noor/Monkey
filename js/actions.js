/**
 * The right-hand action column: Like, Plays, Share, Save. (Remix is the existing
 * shuffle button, wired in player.js.)
 *
 * Nothing here can affect playback. With the traffic service unset or down the
 * buttons still work -- likes are remembered on the device, counts stay blank.
 */
import { track, clientId, fetchCounts, trackingOn } from './track.js';

const $ = (id) => document.getElementById(id);
const REFRESH_MS = 30000;

/** 950 -> "950", 1200 -> "1.2K", 15000 -> "15K", 2300000 -> "2.3M" */
export function compact(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  const f = (x, unit) => `${(x >= 10 ? Math.round(x) : Math.round(x * 10) / 10)}${unit}`;
  if (v >= 999500) return f(v / 1e6, 'M');      // not "1000K"
  if (v >= 1e3) return f(v / 1e3, 'K');
  return String(v);
}

const likeBtn = $('likeBtn');
const likeCount = $('likeCount');
const playCount = $('playCount');
const shareCount = $('shareCount');
const toastEl = $('toast');

let liked = false;
let likes = null;     // null = unknown (service unset or unreachable): show no number
let toastTimer = 0;

try { liked = localStorage.getItem('monkey-liked') === '1'; } catch { /* blocked */ }

function paint() {
  likeBtn.classList.toggle('is-on', liked);
  likeBtn.setAttribute('aria-pressed', String(liked));
  likeCount.textContent = likes == null ? '' : compact(likes);
}

function applyCounts(c) {
  if (!c) return;
  if (typeof c.likes === 'number') likes = c.likes;
  if (typeof c.plays === 'number') playCount.textContent = compact(c.plays);
  if (typeof c.shares === 'number' && c.shares > 0) shareCount.textContent = compact(c.shares);
  if (typeof c.youLiked === 'boolean') {
    liked = c.youLiked;
    try { localStorage.setItem('monkey-liked', liked ? '1' : '0'); } catch { /* blocked */ }
  }
  paint();
}

export function toast(message, ms = 3200) {
  toastEl.textContent = message;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), ms);
}

/* ---------------------------------------------------------------- like -- */

// Likes are sent one at a time, in order, so a quick double-tap can never land
// as "unlike, then like" and leave the server disagreeing with the heart.
let chain = Promise.resolve();

likeBtn.addEventListener('click', () => {
  liked = !liked;
  if (likes != null) likes = Math.max(0, likes + (liked ? 1 : -1));
  try { localStorage.setItem('monkey-liked', liked ? '1' : '0'); } catch { /* blocked */ }
  paint();
  if (liked) {
    likeBtn.classList.remove('is-popping');
    void likeBtn.offsetWidth;                 // restart the animation on a quick re-like
    likeBtn.classList.add('is-popping');
  }
  const type = liked ? 'like' : 'unlike';
  chain = chain.then(async () => {
    const reply = await track(type, { cid: clientId() });
    if (reply && reply.counts && type === (liked ? 'like' : 'unlike')) {
      likes = reply.counts.likes;               // only trust it if no newer tap is pending
      paint();
    }
  });
});

/* --------------------------------------------------------------- share -- */

$('shareBtn').addEventListener('click', async () => {
  const url = `${location.origin}/?from=share`;
  try {
    if (navigator.share) {
      await navigator.share({ title: document.title, url });
    } else {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    }
  } catch {
    return;                                     // cancelled or blocked: not a share
  }
  track('share').then((r) => r && r.counts && applyCounts({ shares: r.counts.shares }));
});

/* ---------------------------------------------------------------- save -- */

// A web page cannot add itself to the bookmarks, so Save says how, for this device.
$('saveBtn').addEventListener('click', () => {
  track('save');
  const ua = navigator.userAgent;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return toast('Already saved to your home screen');
  if (/iphone|ipad|ipod/i.test(ua)) return toast('Tap the Share button, then "Add to Home Screen"', 5200);
  if (/android/i.test(ua)) return toast('Tap the menu (⋮), then "Add to Home screen"', 5200);
  const mac = /mac/i.test(navigator.platform || ua);
  toast(`Press ${mac ? '⌘' : 'Ctrl'} + D to bookmark this page`, 4500);
});

/* --------------------------------------------------------------- remix -- */

$('replay').addEventListener('click', () => { track('remix'); });

/* -------------------------------------------------------------- counts -- */

paint();
if (trackingOn()) {
  const refresh = async () => { if (!document.hidden) applyCounts(await fetchCounts()); };
  refresh();
  setInterval(refresh, REFRESH_MS);
}
