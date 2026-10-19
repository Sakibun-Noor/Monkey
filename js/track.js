/**
 * Reports visits and plays to the shared Traffic service.
 *
 * Fire-and-forget by design: nothing here may ever slow the video, throw, or
 * change what a visitor sees. If the service is unset, down, slow or blocked by
 * an ad-blocker, tracking quietly does nothing.
 */

export const SITE = 'wildanimalchannel';

// Where the deployed Traffic service lives. Empty = tracking off. For testing,
// ?track=http://localhost:5190 overrides it for that page load only.
const DEFAULT_ENDPOINT = '';

function endpoint() {
  let base = DEFAULT_ENDPOINT;
  try {
    const q = new URLSearchParams(location.search).get('track');
    if (q && /^https?:\/\//.test(q)) base = q;
  } catch { /* no URL support: stay off */ }
  return base ? base.replace(/\/$/, '') : '';
}

/**
 * A random id kept on this device, only used so one person can like once. Not a
 * cookie and never sent with plays or views. Falls back to a per-visit id when
 * storage is blocked (private browsing), where a like just won't persist.
 */
let cached = '';
export function clientId() {
  if (cached) return cached;
  try { cached = localStorage.getItem('monkey-cid') || ''; } catch { /* blocked */ }
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(cached)) {
    cached = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('monkey-cid', cached); } catch { /* blocked */ }
  }
  return cached;
}

/**
 * The visitor's country, asked of this site's own tiny /api/geo once per page load and
 * reused. Resolves to '' if it cannot be had; tracking never waits long for it.
 */
let geo;
function country() {
  geo ||= fetch('/api/geo', { signal: AbortSignal.timeout(2500) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (/^[A-Z]{2}$/.test(j?.country || '') ? j.country : ''))
    .catch(() => '');
  return geo;
}

export const trackingOn = () => !!endpoint();

/** Public totals for this site, plus whether this device has liked it. Null if unavailable. */
export async function fetchCounts() {
  const base = endpoint();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/counts?site=${SITE}&item=main&cid=${clientId()}`, {
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Send one event. Resolves with the service's reply, or null if anything goes wrong. */
export async function track(type, extra = {}) {
  const base = endpoint();
  if (!base) return null;
  try {
    const cc = await country();
    const from = new URLSearchParams(location.search).get('from') || '';
    const res = await fetch(`${base}/api/collect`, {
      method: 'POST',
      // text/plain keeps this a "simple" request: no extra preflight round trip.
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({
        site: SITE, item: 'main', type, from, ref: document.referrer, path: location.pathname, ...(cc && { country: cc }), ...extra,
      }),
      keepalive: true,
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
