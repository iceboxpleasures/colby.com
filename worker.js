/**
 * Cloudflare Worker — photo-gallery R2 proxy
 *
 * Paste this into the Workers dashboard code editor (not the file uploader).
 *
 * Before deploying, add an R2 binding in Settings → Bindings:
 *   Variable name : PHOTOS
 *   Bucket        : photo-gallery
 *
 * Routes:
 *   GET /list        → JSON array of { key, url } for every image in the bucket
 *   GET /<filename>  → serves the image directly from R2
 */

const ALLOWED_ORIGIN = 'https://colbiosity.com';
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '';

  const corsHeaders = {
    'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : '',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  // ── GET /list — return all images as JSON ──────────────────────
  if (url.pathname === '/list') {
    let cursor;
    const images = [];

    do {
      const listed = await PHOTOS.list({ cursor, limit: 1000 });
      for (const obj of listed.objects) {
        const ext = obj.key.split('.').pop().toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          images.push({
            key: obj.key,
            url: `https://gallery.colbiosity.com/${encodeURIComponent(obj.key)}`,
            uploaded: obj.uploaded,
            size: obj.size,
          });
        }
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    // Newest first
    images.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));

    return new Response(JSON.stringify(images), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  // ── GET /<filename> — serve the image ─────────────────────────
  const key = decodeURIComponent(url.pathname.slice(1));

  if (!key) {
    return new Response('Not found', { status: 404 });
  }

  const object = await PHOTOS.get(key);

  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers(corsHeaders);
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=86400');

  return new Response(object.body, { headers });
}
