# Development guide

This guide is for people changing GeoSuite from the public repository. You do not need access to the maintainer's private operations repository to report an issue, build the app, or submit a pull request.

## How the code becomes an app

```text
phases/*.html + src/shared + src/assets + src/locales
                 ↓ node build/build.mjs
            dist/{Core,Assay,Resource}.html + vendor/ + offline app
                 ↓ optional Windows build
             desktop/dist/Orebit-*.exe
```

- `phases/Core.html`, `Assay.html`, and `Resource.html` are the editable module entry points. They contain `@orebit-inline` markers, so they are **not runnable directly**.
- `src/shared/` contains code reused by the modules. `src/locales/` contains English and Indonesian text. `src/assets/` contains bundled fonts and public sample data. `src/pwa/` contains offline-install assets.
- `build/build.mjs` expands the markers and applies the build patchers. The generated `dist/` directory is ignored by Git; do not submit it in a PR.
- `desktop/build_exe.py` packages the same built HTML with `desktop/orebit_wrapper.py` into separate Windows executables. EXE builds are checked with `desktop/verify-exe-build.py` on release.
- `vendor/` contains checked-in third-party libraries; review [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) before changing one.

## First local build

Install Node.js 18+ and Python 3.9+. From the repository root:

```bash
npm run doctor
npm run dev
```

The preview builds all modules and prints the Core address; the same commands work in Windows PowerShell, macOS and Linux/cloud. It serves only `dist/`, defaults to loopback, and needs no npm install. Stop with Ctrl+C and restart after editing to rebuild. An occupied port can be changed with `npm run dev -- --port 8768`; `npm run dev -- --no-build` serves an existing complete build. The build checks platform-appropriate Python candidates for Python 3.9+ and works from source ZIPs without Git. `doctor` checks prerequisites, not application correctness or deployment.

On a remote cloud machine, the printed loopback address belongs to that machine. Use its supported port forwarding or run Playwright there; opening that address on a laptop reaches the laptop. Publishing to a VPS additionally needs a verified artifact, target configuration and a supported transport. HTTPS access and a working browser terminal do not prove raw SSH access. Development and tests do not require those deployment credentials.

For a module-specific change, edit the source in `phases/` or `src/`, rebuild, and verify the corresponding file in `dist/`. If the rule belongs in multiple modules, place it in `src/shared/` once. When changing user-visible text, update both EN and ID locale sources.

## Run tests

Fast checks require no npm dependencies:

```bash
npm test
```

To run the browser checks, install Playwright and Chromium for Python, build with `npm run build`, then start three local servers on ports 8767, 8768, and 8769. Most older integration scripts use those ports; cross-module handoff uses all three modules on one origin (port 8767):

```bash
python3 -m pip install playwright "PyMuPDF>=1.26,<2"
python3 -m playwright install chromium
python3 -m http.server 8767 -d dist &
python3 -m http.server 8768 -d dist &
python3 -m http.server 8769 -d dist &
sleep 2
python3 tests/test_pipeline_known_answer.py
python3 tests/test_lab_conventions.py
python3 tests/test_estimation_inputs.py
python3 tests/test_module_handoff.py
python3 tests/test_pwa_install.py
python3 tests/test_pwa_subpath.py
python3 tests/test_update_and_links.py
python3 tests/test_desktop_bridge.py
python3 tests/test_vignettes.py
```

Stop the background servers afterward. `test_vignettes.py` drives tutorial workflows and may take longer or require access to the public tutorial datasets. The public [CI workflow](../.github/workflows/ci.yml) is the reference for the complete tested command sequence and environment.

For a numeric fix, add a small known-answer case with an independently calculated expected value. A test that calls the same calculation twice will not catch a wrong formula. For a UI or import fix, exercise the user path that was broken, including file upload when the bug only appears after upload.

## Desktop storage and module handoff

The Windows EXEs serve their built HTML at stable loopback origins: Core 18767, Assay 18768, Resource 18769. WebView2 stores projects and preferences in the per-user Orebit profile. If a port is occupied, that session uses a temporary port; close the conflicting process and reopen the EXE to see projects at the normal origin. Never bind the server to a non-loopback interface.

"Continue in Assay/Resource" stores one CSV under the user's Orebit handoff directory for at most 30 minutes. It starts the next EXE when found beside the current EXE; otherwise the user can open it manually. The receiving EXE imports through its existing file-input path and deletes the handoff record. No private drillhole data is sent to GitHub.

The source phase files carry a `-source` placeholder. `npm run build` replaces it in `dist/` with a deterministic ID derived from the module version and SHA-256 of the inlined source bytes. This works for forks and source ZIPs without Git. Do not edit generated `dist/` files or add a `-dirty` stamp to an exported build.

## Hosting in a subfolder

Serve the complete `dist/` folder under one path, such as `/geosuite/`. The manifest, service worker, shortcuts and cached assets resolve relative to that path. Use HTTPS (or localhost) for service workers and open each module online once before relying on offline use. Release checks from a local build contact `https://geosuite.orebit.id/03-latest.json`; geological data stays local.

## Send a change

1. Search [issues](https://github.com/ghoziankarami/geosuite/issues) and read [CONTRIBUTING.md](../CONTRIBUTING.md).
2. Change editable source, docs, and relevant tests. Do not commit `dist/`, secrets, customer data, or confidential drillhole files.
3. Build all three modules, run `npm test`, and run relevant browser checks. Describe the expected value and observed output for calculation changes.

4. Open a PR here. The maintainer records the matching change in the canonical development source before the next public export; you do not need that private checkout. See the PR template for carry-back status.

Core exports structural density under the canonical `density` field; standard SG/BD_TM3 headers map to it, and other headers can be assigned manually. Measured zeros are retained as grades; blank grade columns are excluded. Preserve the values, units and schema metadata when continuing to Assay/Resource.

### UI and teaching-data regression coverage

The action/disclosure and Core exercise suites own isolated local servers:

```bash
python tests/test_action_hierarchy.py
python tests/test_core_training.py
```

They exercise real Chromium pages, editable settings, keyboard disclosure, mobile overflow, plot layout, missing vs zero grades, and ZIP → CSV upload → validation → corrected re-upload. Run `python tests/test_module_handoff.py` with all modules on port 8767 to verify rows and density between phases. These tests supplement the independent numerical and report suites; a build alone does not certify a screening result.


Security reports belong through the private channel in [SECURITY.md](../SECURITY.md). For input examples, prefer synthetic or anonymised data. Public issues and PR attachments are visible to everyone.

The guided Assay workflow and native PDF interpretation ledger are exercised by
`python tests/test_assay_workflow.py`, including an actual upload/download, edited
controls, stale reviews, long-note pagination and a mobile viewport.

Run `python tests/test_screening_navigation.py` for the common dashboard,
Advanced sidebar, top stage controls, custom variogram calculation, optional
diagnostics, report-button revisits and EN/ID mobile layouts. This opens a real
browser. `test_core_training.py` also imports the one-click imperfect example
and verifies restoration through the regular file-upload boundary.

Run `python tests/test_screening_reports.py` for native PDF/PNG downloads,
four-card executive hierarchy, EN/ID text, page bounds/bookmarks, readable
structured audit fields and independent selected-tonnage/grade/metal answers.
The test also checks missing grades, tiny values, no estimate and preservation
of the actual cutoff, confidence filter and existing grade-tonnage curve.
