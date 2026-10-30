// Tells the page where it is being viewed from, using what Vercel already worked out from the
// visitor's address: country, state or region, and city. The Traffic service on cPanel has no way
// to work this out, so the page passes it on. It is approximate (it is where the internet
// connection is, not necessarily the person). Nothing is stored here, and the address is never sent on.
export default function handler(req, res) {
  const header = (name) => String(req.headers[name] || '');
  const country = header('x-vercel-ip-country').slice(0, 2).toUpperCase();
  const region = header('x-vercel-ip-country-region').slice(0, 3).toUpperCase();
  let city = header('x-vercel-ip-city');                 // Vercel sends the city URL-encoded
  try { city = decodeURIComponent(city); } catch { /* leave it as received */ }
  city = city.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.status(200).json({
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    region: /^[A-Z0-9]{1,3}$/.test(region) ? region : null,
    city: city || null,
  });
}
