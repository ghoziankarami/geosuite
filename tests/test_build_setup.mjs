import assert from "node:assert/strict";
import { resolvePython } from "../build/python-launcher.mjs";

const calls = [];
const spawn = (command, args) => {
  calls.push([command, args]);
  return { status: command === "python" ? 0 : 1 };
};
assert.deepEqual(resolvePython("win32", spawn), { command: "python", args: [] });
assert.deepEqual(calls.map(([command]) => command), ["py", "python"]);
assert.deepEqual(calls[0][1].slice(0, 1), ["-3"]);

assert.deepEqual(resolvePython("linux", (command) => ({ status: command === "python3" ? 0 : 1 })),
  { command: "python3", args: [] });
assert.throws(() => resolvePython("win32", () => ({ status: 1 })), /Python 3\.9\+/);
console.log("PASS: Python launcher fallback and version refusal");
