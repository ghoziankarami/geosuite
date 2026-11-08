// Validate frozen offline assets before generating any application output.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const required = ['html2canvas.min.js', 'jspdf.umd.min.js', 'jszip.min.js', 'plotly.min.js'];

export function verifyVendorAssets(vendor, lockPath) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (lock.schema_version !== 1 || JSON.stringify(Object.keys(lock.files).sort()) !== JSON.stringify(required))
    throw new Error('Vendor lock must identify all four offline libraries');
  for (const name of required) {
    const expected = lock.files[name];
    if (!Number.isSafeInteger(expected.bytes) || expected.bytes <= 0 || !/^[0-9a-f]{64}$/.test(expected.sha256))
      throw new Error(`Invalid vendor identity: ${name}`);
    const bytes = readFileSync(path.join(vendor, name));
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== expected.bytes || actual !== expected.sha256)
      throw new Error(`Vendor differs from reviewed lock: ${name}; restore the reviewed asset or review its upgrade`);
  }
}
