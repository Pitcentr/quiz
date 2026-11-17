import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createQuizEngine } from './engine.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 65536) {
        reject(Object.assign(new Error('too large'), { code: 'LIMIT' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, engine) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const params = Object.fromEntries(url.searchParams.entries());
    if (req.method === 'POST') {
      const raw = await readBody(req);
      if (raw) Object.assign(params, JSON.parse(raw));
    }
    if (!params.action) params.action = 'ping';
    const result = await engine.handle(params.action, params);
    sendJson(res, 200, result);
  } catch (error) {
    const message = error && error.code === 'LIMIT' ? 'Слишком большой запрос' : 'Некорректный запрос';
    sendJson(res, 200, { success: false, data: null, error: { code: 'INVALID_INPUT', message } });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = normalize(join(root, pathname));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (filePath !== root && !filePath.startsWith(rootWithSep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': types[extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  createReadStream(filePath).pipe(res);
}

export function startServer(options = {}) {
  const engine = options.engine || createQuizEngine();
  const port = options.port || 8787;
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname === '/exec' || pathname === '/api') {
      handleApi(req, res, engine);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end('Method not allowed');
      return;
    }
    serveStatic(req, res);
  });
  server.listen(port, '127.0.0.1');
  return { server, engine, port };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  const started = startServer();
  console.log('Викторина: http://127.0.0.1:' + started.port + '/');
  console.log('Локальный API: http://127.0.0.1:' + started.port + '/exec');
}
