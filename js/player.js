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
const IDLE_MS = 3000;           // controls auto-hide while playing
const STALL_GRACE_MS = 200;     // a readyState dip shorter than this is not a real stall
const SCRUB_SEEK_MS = 120;      // seeking the video per drag pixel makes iOS stutter

// The mixer's sample-accurate clock is authoritative and the muted video is
// walked onto it, never the reverse. Thresholds are deliberately loose: the
// narration is a voiceover over B-roll, not lip-synced dialogue, so a fifth of a
// second out is invisible -- whereas seeking the video element is an expensive,
// visible hitch on iOS, and rewriting playbackRate every frame is what made the
// picture stutter there.
const HARD_RESYNC = 1.0;    // only an egregious gap is worth a visible seek
const SOFT_DRIFT = 0.25;    // below this, leave the picture alone entirely
const NUDGE_SETTLE = 0.08;  // once nudging, correct down to here before letting go
const MAX_NUDGE = 0.02;     // +/- 2% playback rate, capped

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
const pop = new Pop(POP_SFX, { volume: POP_VOLUME, context: mixer.ctx });

// Any touch anywhere is a chance to unlock, not just one that reaches play():
// iOS also interrupts the context on calls and Siri, and a tap that lands during
// a load returns early. Both handlers no-op once the context is already running.
const unlockAudio = () => { mixer.unlock(); pop.unlock(); };
document.addEventListener('pointerdown', unlockAudio, { capture: true });
document.addEventListener('touchend', unlockAudio, { capture: true });

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
  pendingPlay: false,   // a play tap that landed mid-load, honored once ready
  playToken: 0,         // invalidates an audio start still waiting on the iOS unlock
  idleTimer: 0,
};

let nudging = false;
let audioStartPending = false;
let stalledSince = 0;
let scrubSeekTimer = 0;
let standby = null;     // Promise<{combo, narration, music}> for the *next* mix, decoded ahead of time

// Last values written to the DOM / audio params, so per-frame work can be skipped
// when nothing actually moved. repaint() forces the next pass through.
let lastPct = -1;
let lastBuffered = -1;
let lastTimeText = '';
let lastFade = -1;
let lastBuffering = null;
const repaint = () => { lastPct = -1; lastBuffered = -1; lastTimeText = ''; lastFade = -1; };

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

function fetchCombo(combo) {
  return Promise.all([mixer.decode(combo.narrator.src), mixer.decode(combo.music.src)])
    .then(([narration, music]) => ({ combo, narration, music }));
}

/**
 * Warm the next mix while this one plays. Shuffle used to download and decode
 * a megabyte of audio *after* the tap, which on a phone is a 2-4 second dead
 * stall on a play button. With the standby already decoded it is instant.
 */
function prefetchNext() {
  if (!standby) standby = fetchCombo(nextCombo());
  return standby;
}

async function takeStandby() {
  const next = await prefetchNext();
  standby = null;
  applyCombo(next);
}

function applyCombo({ combo, narration, music }) {
  state.combo = combo;
  state.last = { narrator: combo.narrator.id, music: combo.music.id, set: combo.set.id };
  mixer.setBuffer('narration', narration);
  mixer.setBuffer('music', music);
  commentLayer.setSet(combo.set);
  paintCombo(combo);
}

function paintCombo({ narrator, music: bed, set }) {
  els.chipSet.textContent = set.label;
  els.chipNarrator.textContent = narrator.label.split(' — ')[0];
  els.chipMusic.textContent = bed.label;
  els.chipCombo.textContent =
    `${set.comments.length} comments · 1 of ${totalCombos.toLocaleString()} mixes`;
}

function setLoading(on) {
  state.loading = on;
  stage.classList.toggle('is-loading', on);
}

/* -------------------------------------------------------------- control -- */

/**
 * Synchronous on purpose: awaiting anything before `video.play()` would break
 * the user-gesture chain that mobile autoplay policy requires, and the pop
 * warm-up must never be able to gate playback.
 */
function play() {
  // Unlock before the loading gate, never after it. On a phone the common case
  // is a tap that lands while the mix is still downloading; if that tap returns
  // early, the only real user gesture is spent and the deferred play() runs from
  // a promise callback, which iOS refuses to resume an AudioContext from. The
  // muted video is allowed to start without a gesture, so the symptom is a video
  // that plays in complete silence.
  pop.unlock();
  mixer.unlock();

  if (state.loading) {
    state.pendingPlay = true;
    stage.classList.add('is-loading');   // the spinner, so the tap visibly landed
    return;
  }
  state.pendingPlay = false;
  stage.classList.remove('is-ended');
  state.playToken += 1;

  const p = video.play();
  if (p && p.catch) p.catch(() => {});

  // Audio does not start here. reconcileAudio() starts it the moment the picture
  // is actually rolling, so on a phone that still has to buffer the video, the
  // two begin together instead of the narration running ahead of a frozen frame.
  reconcileAudio(performance.now());
}

function pause() {
  state.pendingPlay = false;  // most recent tap wins over one still queued from a load
  state.playToken += 1;       // and invalidates an audio start still waiting on unlock
  nudging = false;
  video.pause();
  mixer.stopAll();
}

function toggle() {
  if (video.paused) play(); else pause();
}

/** Replay: rewind and roll a brand new, non-repeating combination. */
async function newMix() {
  if (state.loading) return;   // a second tap mid-shuffle must not race the first
  setLoading(true);
  pause();
  stage.classList.remove('is-ended');
  video.currentTime = 0;
  commentLayer.reset();
  await takeStandby();
  setLoading(false);
  play();
}

function seekTo(t) {
  const clamped = Math.max(0, Math.min(t, duration()));
  stage.classList.remove('is-ended');
  mixer.stopAll();               // never let audio run on from the old position
  video.currentTime = clamped;   // reconcileAudio() restarts it once the seek lands
  commentLayer.rebuildAt(clamped);
  repaint();
  paintProgress();
}

/** Wind everything down and show the end card. Idempotent. */
function endPlayback() {
  if (stage.classList.contains('is-ended')) return;
  state.playToken += 1;
  mixer.stopAll();
  video.pause();
  setVideoRate(1);
  nudging = false;
  commentLayer.reset();
  stage.classList.add('is-ended');
  markIdle(false);
  clearTimeout(state.idleTimer);
  video.currentTime = 0;          // frame 0 becomes the still
  els.fade.style.opacity = '0';
  repaint();
}

const duration = () =>
  (isFinite(video.duration) && video.duration > 0 ? video.duration : VIDEO.duration);

/* ------------------------------------------------------------ audio sync -- */

/** True only when the video element is genuinely advancing frames. */
function videoRolling() {
  return !video.paused && !video.ended && !video.seeking && !state.scrubbing
    && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
}

/**
 * Keep the audio's existence in lockstep with the picture. Called every tick.
 * Paused, seeking, scrubbing: stop at once. A buffering dip: stop after a short
 * grace, since some browsers flicker readyState for a frame during smooth
 * playback and restarting audio on every flicker would itself sound broken.
 * Rolling again: start from wherever the video actually is.
 */
function reconcileAudio(now) {
  if (videoRolling()) {
    stalledSince = 0;
    if (!mixer.running && !audioStartPending) startAudioAtVideo();
    return;
  }
  if (!mixer.running) return;
  if (video.paused || video.ended || video.seeking || state.scrubbing) {
    mixer.stopAll();
    return;
  }
  if (!stalledSince) stalledSince = now;
  else if (now - stalledSince > STALL_GRACE_MS) mixer.stopAll();
}

function startAudioAtVideo() {
  audioStartPending = true;
  const token = state.playToken;
  mixer.whenRunning().then((ok) => {
    audioStartPending = false;
    // Not running means iOS still has the context locked; reconcile simply
    // tries again next tick, and the next touch anywhere unlocks it.
    if (!ok || token !== state.playToken || !videoRolling()) return;
    mixer.startAll(video.currentTime);
  });
}

/* ----------------------------------------------------------------- loop -- */

/** One pass of the sync loop. Idempotent, so it is safe to call from both drivers. */
function tick() {
  const now = performance.now();
  reconcileAudio(now);

  const t = mixer.running ? mixer.now() : video.currentTime;
  const live = videoRolling();

  // Music and monkey duck away with the picture over the last second. Narration
  // is left alone -- it is content, and cutting a narrator mid-word sounds broken.
  // This is flat 0 for the first 43 of 44 seconds, so only write when it moves:
  // re-targeting an AudioParam every frame is pointless work on the audio thread.
  const fade = fadeAmount(t);
  if (fade !== lastFade) {
    mixer.setScale('music', 1 - fade);
    mixer.setScale('monkey', 1 - fade);
    els.fade.style.opacity = String(fade);
    lastFade = fade;
  }

  const buffering = !video.paused && !video.ended && !state.scrubbing
    && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
  if (buffering !== lastBuffering) {
    stage.classList.toggle('is-buffering', buffering);
    lastBuffering = buffering;
  }

  if (mixer.running && t >= duration()) endPlayback();
  if (live && mixer.running) walkVideoOntoAudioClock(t);
  if (live) commentLayer.update(t);

  paintProgress();
}

/** Never touch the audio: nudge the muted video's rate so it tracks the mixer's clock. */
function walkVideoOntoAudioClock(t) {
  const drift = video.currentTime - t;
  const mag = Math.abs(drift);

  if (mag > HARD_RESYNC) {
    // The seek flips video.seeking, which stops the audio; it restarts on the
    // far side at the video's new position, so the two land together.
    video.currentTime = t;
    setVideoRate(1);
    nudging = false;
    return;
  }

  // Hysteresis: start correcting at SOFT_DRIFT, but keep going until well inside
  // it, so the rate isn't flipped on and off around the threshold every frame.
  if (mag > SOFT_DRIFT) nudging = true;
  else if (mag < NUDGE_SETTLE) nudging = false;

  if (!nudging) { setVideoRate(1); return; }
  setVideoRate(1 + Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, -drift * 0.5)));
}

function setVideoRate(r) {
  if (Math.abs(video.playbackRate - r) > 0.001) video.playbackRate = r;
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

// Style writes here land on every frame from two drivers. Skipping the ones that
// would not change anything keeps the compositor off the critical path on iOS,
// where this was a real source of stutter.
function paintProgress() {
  const d = duration();
  // While dragging, the bar follows the finger, not the (throttled) video seek.
  const cur = state.scrubbing ? (Number(scrub.value) / 1000) * d : video.currentTime;
  const pct = d ? (cur / d) * 100 : 0;

  if (Math.abs(pct - lastPct) > 0.05) {
    els.fill.style.width = `${pct}%`;
    els.knob.style.left = `${pct}%`;
    if (!state.scrubbing) scrub.value = String(Math.round(pct * 10));
    lastPct = pct;
  }

  if (video.buffered.length) {
    const buffered = (video.buffered.end(video.buffered.length - 1) / d) * 100;
    if (Math.abs(buffered - lastBuffered) > 0.5) {
      els.buffer.style.width = `${buffered}%`;
      lastBuffered = buffered;
    }
  }

  const text = `${clock(cur)} / ${clock(d)}`;
  if (text !== lastTimeText) {
    els.time.textContent = text;
    lastTimeText = text;
  }
}

function clock(s) {
  const v = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- chrome -- */

function markIdle(idle) {
  if (idle && state.scrubbing) return;   // never pull the bar out from under a drag
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

/** The centre button: shuffle from the end card, otherwise play/pause. */
function primaryAction() {
  if (stage.classList.contains('is-ended')) newMix();
  else toggle();
}

els.bigPlay.addEventListener('click', () => { primaryAction(); bumpIdleTimer(); });
els.playToggle.addEventListener('click', () => { toggle(); bumpIdleTimer(); });
els.replay.addEventListener('click', () => { newMix(); bumpIdleTimer(); });
els.muteToggle.addEventListener('click', () => { setMuted(!state.muted); bumpIdleTimer(); });

// Tapping the picture only shows or hides the controls; it never toggles
// playback. A stray touch used to pause the video, and the pause/play buttons
// are what should do that. (On the end card the picture still means "again".)
stage.addEventListener('click', (e) => {
  if (e.target.closest('.controls') || e.target.closest('.bigplay')) return;
  if (stage.classList.contains('is-ended')) { newMix(); return; }
  if (stage.classList.contains('is-idle')) { bumpIdleTimer(); return; }
  if (!video.paused) { clearTimeout(state.idleTimer); markIdle(true); }
});

function beginScrub() {
  if (state.scrubbing) return;
  state.scrubbing = true;
  state.wasPlaying = !video.paused;
  mixer.stopAll();
  stage.classList.add('is-scrubbing');
  markIdle(false);
  clearTimeout(state.idleTimer);
}

function scrubTime() {
  return (Number(scrub.value) / 1000) * duration();
}

// Bar and clock follow the finger immediately; the expensive part -- actually
// seeking the video to show a frame -- is throttled, because iOS grinds to a
// halt when asked for a new frame on every pixel of a drag.
function previewSeek() {
  scrubSeekTimer = 0;
  if (!state.scrubbing) return;
  const t = scrubTime();
  video.currentTime = t;
  commentLayer.rebuildAt(t);
}

scrub.addEventListener('pointerdown', beginScrub);
scrub.addEventListener('input', () => {
  beginScrub();
  paintProgress();
  if (!scrubSeekTimer) scrubSeekTimer = setTimeout(previewSeek, SCRUB_SEEK_MS);
});

const endScrub = () => {
  if (!state.scrubbing) return;
  state.scrubbing = false;
  clearTimeout(scrubSeekTimer);
  scrubSeekTimer = 0;
  stage.classList.remove('is-scrubbing');
  seekTo(scrubTime());
  if (state.wasPlaying) play();
  bumpIdleTimer();
};
scrub.addEventListener('pointerup', endScrub);
scrub.addEventListener('pointercancel', endScrub);
scrub.addEventListener('change', endScrub);

video.addEventListener('play', () => {
  stage.classList.add('is-playing');
  els.playToggle.setAttribute('aria-label', 'Pause');
  els.bigPlay.setAttribute('aria-label', 'Pause');
  bumpIdleTimer();
});

// Warm the next mix only once the picture is actually rolling, so the prefetch
// never competes with the video's own first download on a slow connection.
video.addEventListener('playing', () => { prefetchNext(); });

video.addEventListener('pause', () => {
  stage.classList.remove('is-playing');
  els.playToggle.setAttribute('aria-label', 'Play');
  els.bigPlay.setAttribute('aria-label', 'Play');
  markIdle(false);
  clearTimeout(state.idleTimer);
});

// End card: black by 44s, then the first frame reappears with a repeat icon.
video.addEventListener('ended', endPlayback);

// Any seek that lands (ours, a scrub, keyboard) rebuilds the comment stack for
// that moment. The audio side is handled by reconcileAudio(), which sees
// video.seeking flip and restarts from the new position.
video.addEventListener('seeked', () => {
  if (stage.classList.contains('is-ended')) return;
  commentLayer.rebuildAt(video.currentTime);
  repaint();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && !video.paused) pause();
});

window.addEventListener('keydown', (e) => {
  // The scrub range input handles its own arrow/space keys; skip so we don't
  // double-apply the same seek on top of the native slider's own adjustment.
  if (e.target instanceof HTMLInputElement) return;
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

// The first mix. No spinner yet -- only a tap that has to wait earns one, so a
// fast connection never flashes a loading state nobody was waiting on.
state.loading = true;
takeStandby().then(() => {
  setLoading(false);
  if (state.pendingPlay) play();
  // If they reach for shuffle before ever pressing play, still have one ready.
  setTimeout(prefetchNext, 4000);
});

requestAnimationFrame(rafLoop);
setInterval(tick, 120);
paintProgress();

// Exposed for quick manual checks in the console.
window.monkeyPlayer = {
  state, play, pause, newMix, seekTo, video, mixer, commentLayer,
  get standby() { return standby; },
  NARRATORS, MUSIC_BEDS, COMMENT_SETS,
};
