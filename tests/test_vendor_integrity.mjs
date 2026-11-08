import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = [path.resolve(here, '../..'), path.resolve(here, '..')]
  .find(p => existsSync(path.join(p, 'build/vendor-integrity.mjs')));
const { verifyVendorAssets } = await import(pathToFileURL(path.join(root, 'build/vendor-integrity.mjs')));
const work = mkdtempSync(path.join(os.tmpdir(), 'orebit-vendor-check-'));
const vendor = path.join(work, 'vendor');
const lockPath = path.join(work, 'build/vendor-lock.json');
mkdirSync(vendor);
mkdirSync(path.dirname(lockPath));
const names = ['plotly.min.js', 'jspdf.umd.min.js', 'jszip.min.js', 'html2canvas.min.js'];
const files = Object.fromEntries(names.map(name => {
  const bytes = Buffer.from(`reviewed synthetic vendor fixture: ${name}\n`);
  writeFileSync(path.join(vendor, name), bytes);
  return [name, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
}));
const lock = { schema_version: 1, files };
const reset = () => writeFileSync(lockPath, JSON.stringify(lock));
try {
  reset();
  verifyVendorAssets(vendor, lockPath);
  for (const name of names) {
    const original = readFileSync(path.join(vendor, name));
    const changed = Buffer.from(original);
    changed[0] ^= 1;
    writeFileSync(path.join(vendor, name), changed);
    assert.throws(() => verifyVendorAssets(vendor, lockPath), /differs from reviewed lock/);
    writeFileSync(path.join(vendor, name), original);
  }
  writeFileSync(lockPath, JSON.stringify({ ...lock, files: { ...files, 'extra.js': files[names[0]] } }));
  assert.throws(() => verifyVendorAssets(vendor, lockPath), /all four/);
  writeFileSync(lockPath, JSON.stringify({ ...lock, files: { 'plotly.min.js': files[names[0]] } }));
  assert.throws(() => verifyVendorAssets(vendor, lockPath), /all four/);
  reset();

  // Exercise the real build entry in a source-ZIP-shaped root: rejection must
  // happen before a partial dist/ exists, even without Git or a phase tree.
  for (const name of ['build.mjs', 'python-launcher.mjs', 'vendor-integrity.mjs'])
    cpSync(path.join(root, 'build', name), path.join(work, 'build', name));
  writeFileSync(path.join(vendor, 'jspdf.umd.min.js'), 'unreviewed replacement');
  const build = spawnSync(process.execPath, ['build/build.mjs', 'Core'], { cwd: work, encoding: 'utf8' });
  assert.notEqual(build.status, 0);
  assert.match(build.stderr, /Vendor differs from reviewed lock: jspdf/);
  assert.equal(existsSync(path.join(work, 'dist')), false);
  console.log('PASS: four same-size corruptions, missing/extra identities, and build rejection before output');
} finally {
  rmSync(work, { recursive: true, force: true });
}
