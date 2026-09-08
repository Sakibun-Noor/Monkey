/**
 * Dynamic Monkey Video Player.
 *
 * One 44s master video; every playback draws a fresh combination of
 * 1 of 10 narrators x 1 of 10 music beds x 1 of 40 comment sets = 4,000 mixes.
 */

import { VIDEO, POP_SFX, NARRATORS, MUSIC_BEDS, MONKEY_TRACK } from '../data/media.js';
import { COMMENTERS, COMMENT_SETS } from '../data/comment-sets.js';
import { Mixer } from './mix.js';
import { CommentLayer } from './comments.js';
import { Pop } from './pop.js';

// Loudness order fixed by the client, 08.25.26:
//   narrator > monkey sounds > music > click.
// Monkey sits just under the narrator ("almost same volume ... but shouldn't be
// as loud or louder"), music is a background bed, the click is barely audible.
const NARRATION_VOLUME = 0.85;
const MONKEY_VOLUME = 0.68;
const MUSIC_VOLUME = 0.08;
const POP_VOLUME = 0.03;

const FADE_START = 43;          // video fades to black across the last second
const IDLE_MS = 2600;           // controls auto-hide while playing

// The video is the master timeline everywhere else in this file, but its own
// clock is now the thing being corrected -- the audio mixer's sample-accurate
// clock is authoritative, and the (muted) video is walked onto it, since a
// picture drifting by a few ms is invisible but audio drift is not.
const HARD_RESYNC = 0.28;  // seconds of drift that warrant a hard seek
const SOFT_DRIFT = 0.045;  // seconds of drift corrected by rate nudging
const MAX_NUDGE = 0.03;    // +/- 3% playback rate, capped (client-approved safety margin)

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
  fade: $('fade'),
};

const mixer = new Mixer();
mixer.addTrack('narration', { volume: NARRATION_VOLUME });
mixer.addTrack('music', { volume: MUSIC_VOLUME });
mixer.addTrack('monkey', { volume: MONKEY_VOLUME });
const pop = new Pop(POP_SFX, { volume: POP_VOLUME });

// A hard video resync (below) fires its own 'seeked' event; this flag stops
// that from being mistaken for a user/external seek and re-triggering the mixer.
let suppressSeekedSync = false;
const commentLayer = new CommentLayer($('comments'), COMMENTERS, {
  onPop: () => pop.play(),
});

// The video's own location audio stays out of the mix -- it is the source of the
// human conversations the client wants gone. The monkey sounds come back in via
// `monkey`, a speech-cleaned pass over that same audio.
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
    mixer.load('narration', combo.narrator.src),
    mixer.load('music', combo.music.src),
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
  pop.unlock();    // fire and forget
  mixer.unlock();  // fire and forget -- resume() is called synchronously inside, satisfying iOS
  stage.classList.remove('is-ended');
  const t = video.currentTime;
  mixer.startAll(t);
  const p = video.play();
  if (p && p.catch) {
    p.catch(() => { mixer.stopAll(); });
  }
}

function pause() {
  video.pause();
  mixer.stopAll();
}

function toggle() {
  if (video.paused) play(); else pause();
}

/** Replay: rewind and roll a brand new, non-repeating combination. */
async function newMix() {
  pause();
  stage.classList.remove('is-ended');
  video.currentTime = 0;
  commentLayer.reset();
  await loadCombo(nextCombo());
  play();
}

function seekTo(t) {
  const clamped = Math.max(0, Math.min(t, duration()));
  stage.classList.remove('is-ended');
  video.currentTime = clamped;
  mixer.seek(clamped);
  commentLayer.rebuildAt(clamped);
  paintProgress();
}

const duration = () =>
  (isFinite(video.duration) && video.duration > 0 ? video.duration : VIDEO.duration);

/* ----------------------------------------------------------------- loop -- */

/** One pass of the sync loop. Idempotent, so it is safe to call from both drivers. */
function tick() {
  const t = mixer.running ? mixer.now() : video.currentTime;
  const playing = !video.paused && !video.ended;
  const live = playing && !state.scrubbing;

  // Music and monkey duck away with the picture over the last second. Narration
  // is left alone -- it is content, and cutting a narrator mid-word sounds broken.
  const fade = fadeAmount(t);
  mixer.setScale('music', 1 - fade);
  mixer.setScale('monkey', 1 - fade);
  els.fade.style.opacity = String(fade);

  if (live && mixer.running) walkVideoOntoAudioClock(t);
  if (live) commentLayer.update(t);

  paintProgress();
}

/** Never touch the audio: nudge the muted video's rate so it tracks the mixer's clock. */
function walkVideoOntoAudioClock(t) {
  const drift = video.currentTime - t;
  const mag = Math.abs(drift);

  if (mag > HARD_RESYNC) {
    suppressSeekedSync = true;
    video.currentTime = t;
    video.playbackRate = 1;
  } else if (mag > SOFT_DRIFT) {
    const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, -drift * 0.5));
    video.playbackRate = 1 + nudge;
  } else if (video.playbackRate !== 1) {
    video.playbackRate = 1;
  }
}

/** 0 before 43s, ramping to 1 at the end of the video. */
function fadeAmount(t) {
  if (stage.classList.contains('is-ended')) return 0;
  // Reach solid black a beat before the end so the cut to the still frame
  // happens behind a black screen rather than at 90-odd percent opacity.
  const end = duration() - 0.15;
  if (t <= FADE_START || end <= FADE_START) return 0;
  return Math.max(0, Math.min(1, (t - FADE_START) / (end - FADE_START)));
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
  mixer.setEnabled('narration', !m);
  mixer.setEnabled('music', !m);
  mixer.setEnabled('monkey', !m);
  pop.setMuted(m);
  stage.classList.toggle('is-muted', m);
  els.muteToggle.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
}

/* ---------------------------------------------------------------- events -- */

/** Tapping the picture: shuffle a new mix from the end card, otherwise play/pause. */
function primaryAction() {
  if (stage.classList.contains('is-ended')) newMix();
  else toggle();
}

els.bigPlay.addEventListener('click', () => { primaryAction(); bumpIdleTimer(); });
els.playToggle.addEventListener('click', () => { toggle(); bumpIdleTimer(); });
els.replay.addEventListener('click', () => { newMix(); bumpIdleTimer(); });
els.muteToggle.addEventListener('click', () => { setMuted(!state.muted); bumpIdleTimer(); });

stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.controls') || e.target.closest('.bigplay')) return;
  if (stage.classList.contains('is-idle')) bumpIdleTimer();
  else primaryAction();
  bumpIdleTimer();
});

scrub.addEventListener('pointerdown', () => {
  state.scrubbing = true;
  state.wasPlaying = !video.paused;
  mixer.stopAll();
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

// End card: black by 44s, then the first frame reappears with a repeat icon.
video.addEventListener('ended', () => {
  mixer.stopAll();
  commentLayer.reset();
  stage.classList.add('is-ended');
  markIdle(false);
  clearTimeout(state.idleTimer);
  video.currentTime = 0;          // frame 0 becomes the still
  els.fade.style.opacity = '0';
});

// A seek from anywhere (keyboard, media keys, programmatic) resyncs everything.
// Our own hard-resync corrections also fire 'seeked', so they set the suppress
// flag first and this handler swallows exactly one event for that.
video.addEventListener('seeked', () => {
  if (suppressSeekedSync) { suppressSeekedSync = false; return; }
  if (state.scrubbing) return;
  mixer.seek(video.currentTime);
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

// The monkey bed is the same every playback, so it loads once rather than per mix.
mixer.load('monkey', MONKEY_TRACK.src);

loadCombo(nextCombo());
requestAnimationFrame(rafLoop);
setInterval(tick, 120);
paintProgress();

// Exposed for quick manual checks in the console.
window.monkeyPlayer = {
  state, play, pause, newMix, seekTo, video, mixer, commentLayer,
  NARRATORS, MUSIC_BEDS, COMMENT_SETS,
};
