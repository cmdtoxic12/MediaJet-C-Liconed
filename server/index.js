/**
 * MediaJet Backend – zero external dependencies
 * Uses only Node.js built-ins (http, url, path, fs) + native fetch (Node 18+)
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '66f5cf6778mshb00f72e9432debdp1971dfjsn00e4302cc7de';
const RAPIDAPI_HOST = 'download-all-in-one-lite.p.rapidapi.com';
const PUBLIC_DIR = path.join(__dirname, '../public');

// ── Helpers ──────────────────────────────────────────────────────────────
function selectBestMedia(medias, format) {
  if (!Array.isArray(medias) || medias.length === 0) return null;

  if (format === 'mp3' || format === 'audio') {
    const audio = medias.find(m =>
      m.type === 'audio' && (m.extension === 'mp3' || m.extension === 'm4a')
    );
    if (audio) return audio;
    return medias.find(m => m.type === 'audio') || null;
  }

  const preferred = medias.find(m =>
    m.type === 'video' &&
    m.extension === 'mp4' &&
    (m.quality === 'hd_no_watermark' || m.quality === 'no_watermark')
  );
  if (preferred) return preferred;

  const anyMp4 = medias.find(m => m.type === 'video' && m.extension === 'mp4');
  if (anyMp4) return anyMp4;

  return medias.find(m => m.type === 'video') || medias[0] || null;
}

function sanitizeFilename(name) {
  return (name || 'MediaJet')
    .replace(/[^\w\s\-_.]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  const contentType = types[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ── Extract handler ──────────────────────────────────────────────────────
async function handleExtract(req, res) {
  try {
    const body = await parseBody(req);
    const { url, format = 'mp4' } = body;

    if (!url || typeof url !== 'string') {
      return sendJSON(res, 400, { success: false, error: 'Missing or invalid url' });
    }

    try {
      new URL(url);
    } catch {
      return sendJSON(res, 400, { success: false, error: 'Invalid URL format' });
    }

    const apiUrl = `https://${RAPIDAPI_HOST}/autolink?url=${encodeURIComponent(url)}&format=${format}`;

    const upstream = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST
      }
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error('RapidAPI error:', upstream.status, text.slice(0, 200));
      return sendJSON(res, 502, {
        success: false,
        error: `Upstream API failed (${upstream.status})`
      });
    }

    const data = await upstream.json();

    if (data.error) {
      return sendJSON(res, 422, {
        success: false,
        error: data.message || 'API returned an error for this URL'
      });
    }

    const media = selectBestMedia(data.medias, format);

    if (!media || !media.url) {
      return sendJSON(res, 404, {
        success: false,
        error: 'No suitable media found for the requested format'
      });
    }

    const filename = sanitizeFilename(data.title || 'MediaJet') + '.' + (media.extension || format);

    sendJSON(res, 200, {
      success: true,
      title: data.title || 'Untitled',
      author: data.author || null,
      thumbnail: data.thumbnail || null,
      source: data.source || null,
      duration: data.duration || null,
      media: {
        url: media.url,
        type: media.type,
        extension: media.extension,
        quality: media.quality || null,
        width: media.width || null,
        height: media.height || null,
        size: media.data_size || null
      },
      downloadUrl: `/api/download?url=${encodeURIComponent(media.url)}&filename=${encodeURIComponent(filename)}&ext=${media.extension || format}`
    });
  } catch (err) {
    console.error('Extract error:', err);
    sendJSON(res, 500, { success: false, error: 'Internal server error' });
  }
}

// ── Download proxy ───────────────────────────────────────────────────────
async function handleDownload(req, res, query) {
  try {
    const mediaUrl = query.url;
    const filename = query.filename || 'MediaJet.mp4';
    const ext = query.ext || 'mp4';

    if (!mediaUrl) {
      return sendJSON(res, 400, { error: 'Missing url parameter' });
    }

    if (!/^https?:\/\//i.test(mediaUrl)) {
      return sendJSON(res, 400, { error: 'Invalid media URL' });
    }

    const upstream = await fetch(mediaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://www.tiktok.com/'
      }
    });

    if (!upstream.ok) {
      return sendJSON(res, 502, { error: `Failed to fetch media (${upstream.status})` });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');
    const safeName = sanitizeFilename(filename);

    const headers = {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    };
    if (contentLength) headers['Content-Length'] = contentLength;

    res.writeHead(200, headers);

    // Stream the response body
    const reader = upstream.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    };
    pump().catch(err => {
      console.error('Stream error:', err);
      if (!res.writableEnded) res.end();
    });
  } catch (err) {
    console.error('Download proxy error:', err);
    if (!res.headersSent) {
      sendJSON(res, 500, { error: 'Download proxy failed' });
    }
  }
}

// ── Main server ──────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // API routes
  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJSON(res, 200, { status: 'ok', version: '2.0.0' });
  }

  if (pathname === '/api/extract' && req.method === 'POST') {
    return handleExtract(req, res);
  }

  if (pathname === '/api/download' && req.method === 'GET') {
    return handleDownload(req, res, Object.fromEntries(parsed.searchParams));
  }

  // Static files
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  // Security: prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  // Fallback to index.html for SPA-style routing
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  serveStatic(req, res, filePath);
});

server.listen(PORT, () => {
  console.log(`MediaJet server running on http://localhost:${PORT}`);
  console.log(`API key present: ${!!RAPIDAPI_KEY}`);
});
