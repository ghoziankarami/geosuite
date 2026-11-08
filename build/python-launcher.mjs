import { spawnSync } from "node:child_process";

const VERSION_CHECK = "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)";

// Test each candidate, rather than assuming the Windows Python launcher exists.
// spawn can be injected in the small unit test without changing process.platform.
export function resolvePython(platform = process.platform, spawn = spawnSync) {
  const candidates = platform === "win32"
    ? [["py", ["-3"]], ["python", []], ["python3", []]]
    : [["python3", []], ["python", []]];
  for (const [command, args] of candidates) {
    const result = spawn(command, [...args, "-c", VERSION_CHECK], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (result.status === 0) return { command, args };
  }
  throw new Error("Python 3.9+ is required to build GeoSuite. Install it and make py -3 or python available on PATH.");
}
