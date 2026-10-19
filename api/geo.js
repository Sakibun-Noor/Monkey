// Tells the page which country it is being viewed from, using the address Vercel already
// saw. The Traffic service on cPanel has no way to work this out, so the page passes it on.
// Returns only a two-letter code; nothing is stored here.
export default function handler(req, res) {
  const code = String(req.headers['x-vercel-ip-country'] || '').slice(0, 2).toUpperCase();
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.status(200).json({ country: /^[A-Z]{2}$/.test(code) ? code : null });
}
