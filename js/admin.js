/**
 * Administrator mode for the video itself.
 *
 * Normal viewers never see it. Four taps on the edges of the picture, in order -- top, right,
 * bottom, left, within a few seconds -- switch it on (and the same four taps switch it off).
 * While it is on:
 *   - the two strips above the video (mix chips and the count line) are shown;
 *   - a "Sound" button opens sliders for the narrator, monkey sounds, music and click, so levels
 *     can be tried by ear. They change this device only, and only while Admin is on; leaving
 *     Admin puts every level back to its normal value.
 * The corners are left alone on purpose: buttons and the strips sit there.
 */
import { toast } from './actions.js';

const SEQUENCE = ['top', 'right', 'bottom', 'left'];
const WINDOW_MS = 6000;
const KEYS = [['narration', 'Narrator'], ['monkey', 'Monkey sounds'], ['music', 'Music'], ['click', 'Click']];

// Where each tap must land, as a fraction of the picture (x from the left, y from the top).
// They stay clear of the centre play button, the right-hand icons (below 54%) and the controls.
const ZONES = {
  top: (x, y) => y < 0.16 && x > 0.3 && x < 0.7,
  right: (x, y) => x > 0.84 && y > 0.2 && y < 0.5,
  bottom: (x, y) => y > 0.74 && y < 0.87 && x > 0.3 && x < 0.7,
  left: (x, y) => x < 0.16 && y > 0.25 && y < 0.55,
};

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
};

export function initAdmin({ stage, mixer, pop, defaults }) {
  const bar = $('adminBar');
  const panel = $('adminPanel');
  let levels = { ...defaults };
  try {
    const saved = JSON.parse(store.get('monkey-levels') || '{}');
    for (const [k] of KEYS) if (typeof saved[k] === 'number' && saved[k] >= 0 && saved[k] <= 1) levels[k] = saved[k];
  } catch { /* corrupt: use the normal levels */ }

  const apply = (v) => {
    mixer.setBaseVolume('narration', v.narration);
    mixer.setBaseVolume('monkey', v.monkey);
    mixer.setBaseVolume('music', v.music);
    pop.setVolume(v.click);
  };
  const pct = (v) => Math.round(v * 100);
  const summary = () => KEYS.map(([k, name]) => `${name} ${pct(levels[k])}`).join(', ');

  function paintSliders() {
    for (const [k] of KEYS) {
      const input = panel.querySelector(`input[data-key="${k}"]`);
      input.value = String(pct(levels[k]));
      input.nextElementSibling.textContent = `${pct(levels[k])}%`;
    }
    $('adminSummary').textContent = summary();
  }

  function setAdmin(on, announce) {
    stage.classList.toggle('is-admin', on);
    bar.hidden = !on;
    store.set('monkey-admin', on ? '1' : '0');
    if (!on) { panel.hidden = true; $('adminSound').setAttribute('aria-expanded', 'false'); }
    apply(on ? levels : defaults);
    if (announce) toast(on ? 'Admin mode on' : 'Admin mode off', 1800);
  }

  for (const [k] of KEYS) {
    panel.querySelector(`input[data-key="${k}"]`).addEventListener('input', (e) => {
      levels[k] = Number(e.target.value) / 100;
      e.target.nextElementSibling.textContent = `${pct(levels[k])}%`;
      $('adminSummary').textContent = summary();
      apply(levels);
      store.set('monkey-levels', JSON.stringify(levels));
    });
  }
  $('adminSound').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    $('adminSound').setAttribute('aria-expanded', String(!panel.hidden));
  });
  $('adminExit').addEventListener('click', () => setAdmin(false, true));
  $('adminReset').addEventListener('click', () => {
    levels = { ...defaults };
    paintSliders(); apply(levels); store.set('monkey-levels', JSON.stringify(levels));
  });
  $('adminCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(summary()); toast('Levels copied', 1800); }
    catch { toast(summary(), 6000); }          // no clipboard access: show them to read out instead
  });

  // The secret taps.
  let step = 0;
  let startedAt = 0;
  stage.addEventListener('click', (e) => {
    if (e.target.closest('.controls, .bigplay, .rail, .csheet, .admin')) return;
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const zone = SEQUENCE.find((z) => ZONES[z](x, y));
    if (!zone) return;                                    // an ordinary tap elsewhere never disturbs a sequence
    const now = performance.now();
    if (step > 0 && now - startedAt > WINDOW_MS) step = 0;
    if (zone === SEQUENCE[step]) {
      if (step === 0) startedAt = now;
      step += 1;
      if (step === SEQUENCE.length) { step = 0; setAdmin(!stage.classList.contains('is-admin'), true); }
    } else {
      step = zone === SEQUENCE[0] ? 1 : 0;                // a wrong edge starts over (a fresh "top" counts as the first tap)
      if (step === 1) startedAt = now;
    }
  });

  paintSliders();
  if (store.get('monkey-admin') === '1') setAdmin(true, false);
}
