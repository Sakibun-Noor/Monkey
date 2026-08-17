/**
 * Dynamic Monkey Video Player.
 *
 * One 44s master video; every playback draws a fresh combination of
 * 1 of 10 narrators x 1 of 10 music beds x 1 of 40 comment sets = 4,000 mixes.
 */

import { VIDEO, POP_SFX, NARRATORS, MUSIC_BEDS } from '../data/media.js';
import { COMMENTERS, COMMENT_SETS } from '../data/comment-sets.js';
import { TrackSync } from './sync.js';
import { CommentLayer } from './comments.js';
import { Pop } from './pop.js';

const MUSIC_VOLUME = 0.26;      // bed sits under the narration
const NARRATION_VOLUME = 1.0;
const IDLE_MS = 2600;           // controls auto-hide while playing

const $ = (id) => document.getElementById(id);

const stage = $('stage');
const video = $('video');
const scrub = $('scrub');
const els = {
  bigPlay: $('bigPlay'),
  playToggle: $('playToggle'),
  muteToggle: $('muteToggle'),
  replay: $('replay'),
  time: $('time'),
  fill: $('scrubFill'),
  buffer: $('scrubBuffer'),
  knob: $('scrubKnob'),
  chipSet: $('chipSet'),
  chipNarrator: $('chipNarrator'),
  chipMusic: $('chipMusic'),
  chipCombo: $('chipCombo'),
};

const narrationEl = new Audio();
const musicEl = new Audio();
for (const a of [narrationEl, musicEl]) {
  a.preload = 'auto';
  a.crossOrigin = 'anonymous';
  a.playsInline = true;
}

const narration = new TrackSync(narrationEl, { volume: NARRATION_VOLUME });
const music = new TrackSync(musicEl, { volume: MUSIC_VOLUME });
const pop = new Pop(POP_SFX, { volume: 0.45 });
const commentLayer = new CommentLayer($('comments'), COMMENTERS, {
  onPop: () => pop.play(),
});

// The base video keeps its own quiet ambience out of the mix; narration and
// music are the soundtrack. Flip to false to blend the location audio back in.
video.muted = true;

const state = {
  combo: null,
  last: { narrator: null, music: null, set: null },
  scrubbing: false,
  wasPlaying: false,
  muted: false,
  loading: false,
  idleTimer: 0,
};

/* ------------------------------------------------------------ selection -- */

/** Pick a random member of `list`, never the one used last time. */
function pickDifferent(list, previousId) {
  if (list.length === 1) return list[0];
  let choice;
  do {
    choice = list[Math.floor(Math.random() * list.length)];
  } while (choice.id === previousId);
  return choice;
}

function nextCombo() {
  return {
    narrator: pickDifferent(NARRATORS, state.last.narrator),
    music: pickDifferent(MUSIC_BEDS, state.last.music),
    set: pickDifferent(COMMENT_SETS, state.last.set),
  };
}

const totalCombos = NARRATORS.length * MUSIC_BEDS.length * COMMENT_SETS.length;

async function loadCombo(combo) {
  state.loading = true;
  state.combo = combo;
  state.last = { narrator: combo.narrator.id, music: combo.music.id, set: combo.set.id };

  commentLayer.setSet(combo.set);
  paintCombo(combo);

  await Promise.all([
    narration.load(combo.narrator.src, combo.narrator.duration),
    music.load(combo.music.src, combo.music.duration),
  ]);
  state.loading = false;
}

function paintCombo({ narrator, music: bed, set }) {
  els.chipSet.textContent = set.label;
  els.chipNarrator.textContent = narrator.label.split(' — ')[0];
  els.chipMusic.textContent = bed.label;
  els.chipCombo.textContent =
    `${set.comments.length} comments · 1 of ${totalCombos.toLocaleString()} mixes`;
}

/* -------------------------------------------------------------- control -- */

/**
 * Synchronous on purpose: awaiting anything before `video.play()` would break
 * the user-gesture chain that mobile autoplay policy requires, and the pop
 * warm-up must never be able to gate playback.
 */
function play() {
  if (state.loading) return;
  pop.unlock();  // fire and forget
  const t = video.currentTime;
  // Prime inside the gesture so iOS/Android allow the audio to start.
  narration.primeFromGesture(t);
  music.primeFromGesture(t);
  const p = video.play();
  if (p && p.catch) {
    p.catch(() => {
      narration.pause();
      music.pause();
    });
  }
}

function pause() {
  video.pause();
  narration.pause();
  music.pause();
}

function toggle() {
  if (video.paused) play(); else pause();
}

/** Replay: rewind and roll a brand new, non-repeating combination. */
async function newMix() {
  pause();
  video.currentTime = 0;
  commentLayer.reset();
  await loadCombo(nextCombo());
  narration.seekTo(0);
  music.seekTo(0);
  play();
}

function seekTo(t) {
  const clamped = Math.max(0, Math.min(t, duration()));
  video.currentTime = clamped;
  narration.seekTo(clamped);
  music.seekTo(clamped);
  commentLayer.rebuildAt(clamped);
  paintProgress();
}

const duration = () =>
  (isFinite(video.duration) && video.duration > 0 ? video.duration : VIDEO.duration);

/* ----------------------------------------------------------------- loop -- */

/** One pass of the sync loop. Idempotent, so it is safe to call from both drivers. */
function tick() {
  const t = video.currentTime;
  const playing = !video.paused && !video.ended;
  const live = playing && !state.scrubbing;

  narration.update(t, live);
  music.update(t, live);
  if (live) commentLayer.update(t);

  paintProgress();
}

// rAF drives the smooth case; a slow interval keeps audio locked to the video
// if rAF gets throttled (low-power mode, backgrounded tab).
function rafLoop() {
  tick();
  requestAnimationFrame(rafLoop);
}

function paintProgress() {
  const d = duration();
  const pct = d ? (video.currentTime / d) * 100 : 0;
  els.fill.style.width = `${pct}%`;
  els.knob.style.left = `${pct}%`;
  if (video.buffered.length) {
    els.buffer.style.width = `${(video.buffered.end(video.buffered.length - 1) / d) * 100}%`;
  }
  if (!state.scrubbing) scrub.value = String(Math.round(pct * 10));
  els.time.textContent = `${clock(video.currentTime)} / ${clock(d)}`;
}

function clock(s) {
  const v = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- chrome -- */

function markIdle(idle) {
  stage.classList.toggle('is-idle', idle);
}

function bumpIdleTimer() {
  markIdle(false);
  clearTimeout(state.idleTimer);
  if (!video.paused) {
    state.idleTimer = setTimeout(() => markIdle(true), IDLE_MS);
  }
}

function setMuted(m) {
  state.muted = m;
  narration.setEnabled(!m);
  music.setEnabled(!m);
  pop.setMuted(m);
  stage.classList.toggle('is-muted', m);
  els.muteToggle.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
}

/* ---------------------------------------------------------------- events -- */

els.bigPlay.addEventListener('click', () => { toggle(); bumpIdleTimer(); });
els.playToggle.addEventListener('click', () => { toggle(); bumpIdleTimer(); });
els.replay.addEventListener('click', () => { newMix(); bumpIdleTimer(); });
els.muteToggle.addEventListener('click', () => { setMuted(!state.muted); bumpIdleTimer(); });

stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.controls') || e.target.closest('.bigplay')) return;
  if (stage.classList.contains('is-idle')) bumpIdleTimer();
  else toggle();
  bumpIdleTimer();
});

scrub.addEventListener('pointerdown', () => {
  state.scrubbing = true;
  state.wasPlaying = !video.paused;
  narration.pause();
  music.pause();
});

scrub.addEventListener('input', () => {
  state.scrubbing = true;
  seekTo((Number(scrub.value) / 1000) * duration());
});

const endScrub = () => {
  if (!state.scrubbing) return;
  state.scrubbing = false;
  seekTo((Number(scrub.value) / 1000) * duration());
  if (state.wasPlaying) play();
  bumpIdleTimer();
};
scrub.addEventListener('pointerup', endScrub);
scrub.addEventListener('pointercancel', endScrub);
scrub.addEventListener('change', endScrub);

video.addEventListener('play', () => {
  stage.classList.add('is-playing');
  els.playToggle.setAttribute('aria-label', 'Pause');
  bumpIdleTimer();
});

video.addEventListener('pause', () => {
  stage.classList.remove('is-playing');
  els.playToggle.setAttribute('aria-label', 'Play');
  markIdle(false);
  clearTimeout(state.idleTimer);
});

video.addEventListener('ended', () => {
  narration.pause();
  music.pause();
  markIdle(false);
});

// A seek from anywhere (keyboard, media keys, programmatic) resyncs everything.
video.addEventListener('seeked', () => {
  if (state.scrubbing) return;
  narration.seekTo(video.currentTime);
  music.seekTo(video.currentTime);
  commentLayer.rebuildAt(video.currentTime);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && !video.paused) pause();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); toggle(); bumpIdleTimer(); }
  if (e.code === 'KeyR') { newMix(); }
  if (e.code === 'KeyM') { setMuted(!state.muted); }
  if (e.code === 'ArrowRight') { seekTo(video.currentTime + 5); bumpIdleTimer(); }
  if (e.code === 'ArrowLeft') { seekTo(video.currentTime - 5); bumpIdleTimer(); }
});

/* ------------------------------------------------------------------ boot -- */

// Warm the roster so a comment never appears before its avatar.
for (const person of COMMENTERS) {
  const img = new Image();
  img.src = person.avatar;
}

loadCombo(nextCombo());
requestAnimationFrame(rafLoop);
setInterval(tick, 120);
paintProgress();

// Exposed for quick manual checks in the console.
window.monkeyPlayer = {
  state, play, pause, newMix, seekTo, video, narration, music, commentLayer,
  NARRATORS, MUSIC_BEDS, COMMENT_SETS,
};
