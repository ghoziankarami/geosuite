#!/usr/bin/env node
// Tahap 2 of docs/architecture-migration-plan.md.
//
// Reads exe-wrapper/pywebview/phases/$PHASE.html, resolves any
// `/* @orebit-inline: <path relative to repo root> */` markers by
// substituting the exact bytes of the referenced asset file, writes the
// result to dist/$PHASE.html, then runs the v194 and help patchers against
// that OUTPUT (Tahap 2.4) until they reach their joint fixed point. src/
// never contains a generated block; everything generated happens here.
//
// Known Windows pitfall (see the plan doc): reading/writing through a text
// layer can normalize line endings on a Windows checkout even when nothing
// "changed". Everything here works on Buffers, not strings -- readFileSync
// without an encoding argument returns a Buffer, and the marker
// substitution below does byte-offset slicing on that Buffer rather than
// decoding to a JS string first -- so there is no text layer for CRLF/LF or
// encoding assumptions to enter. The marker syntax itself is plain ASCII,
// so finding it with a byte-level search is safe regardless of the
// surrounding file's actual encoding.
//
// Usage: node build/build.mjs [Core] [Assay] [Resource]   (default: all three)

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
// Two layouts share this file: orebit-ops (phases under exe-wrapper/, patchers
// under ops/scripts/) and the public GeoSuite tree produced by
// ops/opensource/export-public.py (phases/ and build/patchers/ at the root).
const firstDirWith = (file, ...dirs) => dirs.find(d => existsSync(path.join(d, file))) || dirs[dirs.length - 1];
const SRC_DIR = firstDirWith("Core.html", path.join(ROOT, "phases"), path.join(ROOT, "exe-wrapper", "pywebview", "phases"));
const DIST_DIR = path.join(ROOT, "dist");
// @orebit-inline marker paths are relative to src/, matching where the
// extracted assets actually live (src/assets/fonts/...).
const ASSETS_ROOT = path.join(ROOT, "src");

const ALL_PHASES = ["Core", "Assay", "Resource"];
const requested = process.argv.slice(2);
const phases = requested.length ? requested : ALL_PHASES;

for (const name of phases) {
  if (!ALL_PHASES.includes(name)) {
    console.error(`FATAL: unknown phase "${name}" (expected one of ${ALL_PHASES.join(", ")})`);
    process.exit(2);
  }
}

mkdirSync(DIST_DIR, { recursive: true });

const MARKER_OPEN = Buffer.from("/* @orebit-inline: ");
const MARKER_CLOSE = Buffer.from(" */");

// ─── Tahap 2.4: patchers run here, on build output ─────────────────────────
// The v194 shell and help panel are generated content. They used to be
// injected into the canonical source files by hand-run patchers, which is
// how generated blocks ended up committed inside hand-edited files. src/ is
// now block-free; this build owns the injection, in the documented order
// (v194, then help -- stamp stays a release-time step on the source).
//
// Convergence: v194 anchors its block ABOVE the help panel when one is
// present, while the help patcher inserts immediately before the last
// </body>, so a single v194->help pass over a block-free file can leave one
// newline of spacing that the next pass re-normalizes. Running the pair
// until the bytes stop changing lands on the same joint fixed point from
// any starting spacing; the cap only guards against a future anchor bug
// looping forever.
const PY_EXE = process.platform === "win32" ? "py" : "python3";
const PY_ARGS = process.platform === "win32" ? ["-3"] : [];
const PATCHER_DIR = firstDirWith("orebit_v194_patcher.py", path.join(ROOT, "build", "patchers"), path.join(ROOT, "ops", "scripts", "patchers"));
const PATCHERS = [
  path.join(PATCHER_DIR, "orebit_v194_patcher.py"),
  path.join(PATCHER_DIR, "orebit_help_patcher.py"),
];
const MAX_PATCH_PASSES = 4;

function runPatcher(script, target) {
  const r = spawnSync(PY_EXE, [...PY_ARGS, script, target], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status !== 0) {
    throw new Error(
      `patcher failed (exit ${r.status}): ${script} ${path.basename(target)}\n` +
        `${r.stdout?.toString()}${r.stderr?.toString()}`
    );
  }
}

function patchToFixedPoint(dstPath, phaseName) {
  let prev = readFileSync(dstPath);
  for (let pass = 1; pass <= MAX_PATCH_PASSES; pass++) {
    for (const script of PATCHERS) runPatcher(script, dstPath);
    const now = readFileSync(dstPath);
    if (now.equals(prev)) {
      console.log(`  ${phaseName}: patchers at fixed point (after ${pass - 1} normalization pass(es))`);
      return;
    }
    prev = now;
  }
  throw new Error(
    `${phaseName}: patchers did not converge after ${MAX_PATCH_PASSES} passes -- ` +
      `an anchor or template change has broken the fixed point; do not ship this output.`
  );
}

// Replace every `/* @orebit-inline: <path> */` marker in `buf` with the raw
// bytes of the file at ROOT/<path>. Pure Buffer slicing throughout -- never
// decodes the surrounding HTML to a string, so nothing about it can
// normalize whitespace/newlines/encoding in content this isn't touching.
function resolveInlineMarkers(buf, phaseName) {
  const chunks = [];
  let cursor = 0;
  while (true) {
    const openAt = buf.indexOf(MARKER_OPEN, cursor);
    if (openAt === -1) {
      chunks.push(buf.subarray(cursor));
      break;
    }
    const pathStart = openAt + MARKER_OPEN.length;
    const closeAt = buf.indexOf(MARKER_CLOSE, pathStart);
    if (closeAt === -1) {
      throw new Error(`${phaseName}: unterminated @orebit-inline marker at byte ${openAt}`);
    }
    const assetRelPath = buf.subarray(pathStart, closeAt).toString("utf-8").trim();
    const assetAbsPath = path.join(ASSETS_ROOT, assetRelPath);
    const assetBytes = readFileSync(assetAbsPath); // Buffer
    chunks.push(buf.subarray(cursor, openAt));
    chunks.push(assetBytes);
    cursor = closeAt + MARKER_CLOSE.length;
  }
  return Buffer.concat(chunks);
}

for (const name of phases) {
  const srcPath = path.join(SRC_DIR, `${name}.html`);
  const dstPath = path.join(DIST_DIR, `${name}.html`);
  const srcBytes = readFileSync(srcPath); // Buffer, no text decoding
  const outBytes = resolveInlineMarkers(srcBytes, name);
  writeFileSync(dstPath, outBytes); // Buffer, no text encoding
  patchToFixedPoint(dstPath, name);
  const finalBytes = readFileSync(dstPath);
  console.log(`  ${name}.html  ${srcBytes.length.toLocaleString("en-US")} bytes (src) -> ${finalBytes.length.toLocaleString("en-US")} bytes (dist, patched)`);
}

// The installable-app layer (src/pwa/: manifest, service worker, icons) so that
// dist/ plus vendor/ is a complete, installable, offline web app on its own --
// what the public repo's users self-host and what deploy-geosuite.py publishes.
const PWA_DIR = path.join(ROOT, "src", "pwa");
if (existsSync(PWA_DIR)) {
  copyFileSync(path.join(PWA_DIR, "manifest.webmanifest"), path.join(DIST_DIR, "manifest.webmanifest"));
  copyFileSync(path.join(PWA_DIR, "service-worker.js"), path.join(DIST_DIR, "service-worker.js"));
  mkdirSync(path.join(DIST_DIR, "pwa"), { recursive: true });
  for (const f of readdirSync(path.join(PWA_DIR, "icons"))) {
    copyFileSync(path.join(PWA_DIR, "icons", f), path.join(DIST_DIR, "pwa", f));
  }
}

console.log(`\nBuilt ${phases.length} phase(s) into ${path.relative(ROOT, DIST_DIR)}${path.sep}`);
