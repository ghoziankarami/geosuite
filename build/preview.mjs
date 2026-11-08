import http from 'node:http';
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const modules = ['Core', 'Assay', 'Resource'];
let host = '127.0.0.1', port = 8767, build = true;
function fail(message) { console.error(message); process.exit(1); }
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--no-build') build = false;
  else if (arg === '--host' && process.argv[i + 1]) host = process.argv[++i];
  else if (arg === '--port' && /^\d+$/.test(process.argv[i + 1] || '')) port = Number(process.argv[++i]);
  else if (arg === '--help') { console.log('Usage: node build/preview.mjs [--no-build] [--port 8767] [--host 127.0.0.1]'); process.exit(0); }
  else fail(`Unknown or incomplete option: ${arg}`);
}
if (port > 65535) fail('Port must be between 0 and 65535.');
if (build) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'build/build.mjs'), ...modules], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) fail('Build failed; preview was not started.');
}
const required = [...modules.map(m => `${m}.html`), 'vendor/plotly.min.js', 'vendor/jspdf.umd.min.js'];
for (const name of required) if (!existsSync(path.join(DIST, name))) fail(`Missing built asset: ${name}. Run the build before preview.`);
for (const name of modules) if (readFileSync(path.join(DIST, `${name}.html`), 'utf8').includes('/* @orebit-inline: ')) fail(`Unresolved source in ${name}; preview requires built dist files.`);
const base = realpathSync(DIST);
if (base !== path.join(realpathSync(ROOT), 'dist')) fail('Preview dist must be a real directory inside this checkout.');
const inside = file => file === base || (!path.relative(base, file).startsWith('..' + path.sep) && path.relative(base, file) !== '..' && !path.isAbsolute(path.relative(base, file)));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.csv': 'text/csv; charset=utf-8' };
const server = http.createServer((req, res) => {
  const send = (status, body, type = 'text/plain; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : body); };
  if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return send(405, 'Preview serves files only.'); }
  let pathname;
  try { pathname = decodeURIComponent(req.url.split('?')[0]); } catch { return send(400, 'Invalid URL.'); }
  if (pathname.includes('\0') || pathname.includes('\\')) return send(400, 'Invalid path.');
  if (pathname === '/__orebit_health') return send(200, JSON.stringify({ status: 'serving', modules }), 'application/json');
  if (pathname === '/') { res.writeHead(302, { Location: './Core.html', 'Cache-Control': 'no-store' }); return res.end(); }
  const file = path.resolve(base, '.' + pathname);
  if (!inside(file)) return send(403, 'Path outside preview.');
  try {
    if (!inside(realpathSync(file))) return send(403, 'Path outside preview.');
    const stat = statSync(file);
    if (!stat.isFile()) return send(404, 'File not found.');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res);
  } catch { send(404, 'File not found.'); }
});
server.on('error', error => fail(error.code === 'EADDRINUSE' ? `Port ${port} is occupied. Try npm run dev -- --port ${port + 1}.` : `Preview could not start (${error.code || 'unknown error'}).`));
server.listen(port, host, () => {
  const address = server.address();
  console.log('OREBIT_PREVIEW ' + JSON.stringify({ host, port: address.port, modules }));
  console.log(`Open http://${host.includes(':') ? '[' + host + ']' : host}:${address.port}/Core.html. Ctrl+C stops this preview. Changes need a rebuild/restart.`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
