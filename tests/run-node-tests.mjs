#!/usr/bin/env node
// Runs every Node known-answer / boundary test in tests/known-answer/ and
// fails if any of them fails. No dependencies: `npm test` or `node tests/run-node-tests.mjs`.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'known-answer');
const tests = readdirSync(dir).filter(f => f.endsWith('.mjs')).sort();
const failed = [];
for (const t of tests) {
  const r = spawnSync(process.execPath, [path.join(dir, t)], { encoding: 'utf8' });
  const tail = (r.stdout || '').trim().split('\n').slice(-1)[0] || '';
  const ok = r.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}  ${tail}`);
  if (!ok) { failed.push(t); process.stdout.write((r.stdout || '').split('\n').filter(l => l.includes('❌')).join('\n') + '\n' + (r.stderr || '')); }
}
console.log(`\n${tests.length - failed.length}/${tests.length} test files passed`);
process.exit(failed.length ? 1 : 0);
