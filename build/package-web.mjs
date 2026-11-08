import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolvePython } from './python-launcher.mjs';

const { command, args } = resolvePython();
const result = spawnSync(command, [...args, fileURLToPath(new URL('./package_web.py', import.meta.url)), ...process.argv.slice(2)], {
  stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
