import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync, renameSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

let root = path.dirname(fileURLToPath(import.meta.url));
while (!existsSync(path.join(root, 'build/preview.mjs'))) {
  const parent = path.dirname(root); if (parent === root) throw Error('Repository not found.'); root = parent;
}
const fixture = mkdtempSync(path.join(os.tmpdir(), 'Orebit source ZIP with spaces '));
const running = new Set();
try {
  mkdirSync(path.join(fixture, 'build')); mkdirSync(path.join(fixture, 'dist/vendor'), { recursive: true });
  cpSync(path.join(root, 'build/preview.mjs'), path.join(fixture, 'build/preview.mjs'));
  for (const name of ['Core', 'Assay', 'Resource']) writeFileSync(path.join(fixture, `dist/${name}.html`), `<html><body>${name} fixture</body></html>`);
  for (const name of ['plotly.min.js', 'jspdf.umd.min.js']) writeFileSync(path.join(fixture, `dist/vendor/${name}`), '// fixture');
  writeFileSync(path.join(fixture, 'secret.txt'), 'must not be served');
  const child = spawn(process.execPath, [path.join(fixture, 'build/preview.mjs'), '--no-build', '--port', '0'], { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
  running.add(child);
  const address = await new Promise((resolve, reject) => {
    let output = ''; const timeout = setTimeout(() => reject(Error('Preview did not become ready.')), 15000);
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/OREBIT_PREVIEW (\{[^\n]+\})/); if (match) { clearTimeout(timeout); resolve(JSON.parse(match[1])); } });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(Error(`Preview exited before readiness: ${code}`)); });
  });
  assert.equal(address.host, '127.0.0.1');
  const url = `http://${address.host}:${address.port}`;
  for (const name of ['Core', 'Assay', 'Resource']) { const r = await fetch(`${url}/${name}.html`); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.match(await r.text(), new RegExp(name)); }
  const landing = await fetch(url, { redirect: 'manual' }); assert.equal(landing.status, 302); assert.equal(landing.headers.get('location'), './Core.html');
  assert.deepEqual((await (await fetch(url + '/__orebit_health')).json()).modules, ['Core', 'Assay', 'Resource']);
  assert.equal((await fetch(url + '/Core.html', { method: 'HEAD' })).status, 200);
  assert.equal(await (await fetch(url + '/Core.html', { method: 'HEAD' })).text(), '');
  assert.equal((await fetch(url + '/Core.html', { method: 'POST' })).status, 405);
  assert.equal((await fetch(url + '/vendor/')).status, 404);
  assert.equal((await fetch(url + '/secret.txt')).status, 404);
  const rawStatus = requestPath => new Promise((resolve, reject) => { http.get({ hostname: address.host, port: address.port, path: requestPath }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject); });
  assert.equal(await rawStatus('/%2e%2e/secret.txt'), 403);
  assert.equal(await rawStatus('/%00'), 400); assert.equal(await rawStatus('/%zz'), 400);
  let symlinkTest = 'passed';
  try { symlinkSync(path.join(fixture, 'secret.txt'), path.join(fixture, 'dist/leak.txt')); }
  catch (error) { if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) throw error; symlinkTest = 'unavailable without Windows symlink permission'; }
  if (symlinkTest === 'passed') assert.equal((await fetch(url + '/leak.txt')).status, 403);
  const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped; running.delete(child);
  writeFileSync(path.join(fixture, 'dist/Core.html'), '/* @orebit-inline: unresolved */');
  const invalid = spawn(process.execPath, [path.join(fixture, 'build/preview.mjs'), '--no-build', '--port', '0'], { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] }); running.add(invalid);
  const [code] = await once(invalid, 'exit'); running.delete(invalid); assert.notEqual(code, 0);
  if (symlinkTest === 'passed') {
    renameSync(path.join(fixture, 'dist'), path.join(fixture, 'outside-built'));
    writeFileSync(path.join(fixture, 'outside-built/Core.html'), '<html>fixture</html>');
    symlinkSync(path.join(fixture, 'outside-built'), path.join(fixture, 'dist'), 'junction');
    const escaped = spawn(process.execPath, [path.join(fixture, 'build/preview.mjs'), '--no-build', '--port', '0'], { cwd: os.tmpdir(), stdio: 'ignore' });
    running.add(escaped); const [status] = await once(escaped, 'exit'); running.delete(escaped); assert.notEqual(status, 0);
  }
  console.log(`PASS: relocated source ZIP, spaces, arbitrary cwd, all modules, loopback, HEAD, no directory/private-file exposure, URL validation, unresolved-build refusal; symlink check ${symlinkTest}`);
} finally {
  for (const child of running) child.kill('SIGTERM');
  rmSync(fixture, { recursive: true, force: true });
}
