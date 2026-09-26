import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyGrid } from './shared/bilinear.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(ROOT, 'dist', 'public');
const PORT = Number(process.env.PORT || 8080);
const MAX_BODY = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const startedAt = Date.now();

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

async function serveStatic(res, urlPath) {
  const rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    // 健康检查
    if (url.pathname === '/healthz') {
      sendJson(res, 200, {
        status: 'ok',
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      });
      return;
    }

    // 校核 API：与浏览器页面共用同一数学模块 src/shared/bilinear.js
    if (url.pathname === '/api/verify') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
      }
      let size = 0;
      const chunks = [];
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BODY) {
            sendJson(res, 413, { error: 'body too large' });
            return;
          }
          chunks.push(chunk);
        }
      } catch {
        sendJson(res, 400, { error: 'failed to read body' });
        return;
      }
      let spec;
      try {
        spec = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        sendJson(res, 400, { error: 'invalid JSON' });
        return;
      }
      sendJson(res, 200, verifyGrid(spec));
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    await serveStatic(res, url.pathname);
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  createServer().listen(PORT, '0.0.0.0', () => {
    console.log(`[server] 监听 0.0.0.0:${PORT}，静态目录 ${PUBLIC_DIR}`);
  });
}
