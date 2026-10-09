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
python3 tests/test_grade_units.py
python3 tests/test_core_validation_resolution.py
python3 tests/test_estimation_inputs.py
python3 tests/test_native_png_export.py
python3 tests/test_module_handoff.py
python3 tests/test_pwa_install.py
python3 tests/test_pwa_subpath.py
python3 tests/test_update_and_links.py
python3 tests/test_desktop_bridge.py
python3 tests/test_vignettes.py
```

Stop the background servers afterward. `test_vignettes.py` drives tutorial workflows and may take longer or require access to the public tutorial datasets. The public [CI workflow](../.github/workflows/ci.yml) is the reference for the complete tested command sequence and environment.

For a numeric fix, add a small known-answer case with an independently calculated expected value. A test that calls the same calculation twice will not catch a wrong formula. For a UI or import fix, exercise the user path that was broken, including file upload when the bug only appears after upload.

## Repeatable workflow measurements

The optional benchmark uses a sibling checkout of the public
[orebit-datasets](https://github.com/ghoziankarami/orebit-datasets). It creates and
removes its own CSVs, server and fresh browser contexts. Build first, then run:

```bash
python3 tests/benchmark_workflow_performance.py --datasets ../orebit-datasets \
  --output ../workflow-observations.json --repeats 3 \
  --device-label "my-device-browser" --contention "describe other running work"
```

It checks complete populations, supplied columns, units, coordinate bounds and
renderer errors while measuring actual Core → Assay → Resource actions. Chromium
also provides heap snapshots at action boundaries; these include instrumentation
and are not peak process memory. Latency has no default pass threshold. Record
hardware/browser/load before comparing results; the benchmark does not certify
native Windows, Safari/Dock, GPU rendering, estimation or production stability.
`--browser webkit` selects Playwright's WebKit, not installed Safari.

Native PNG export is shared in `src/shared/plots/png-export.js`. The actual PNG
and ZIP regression checks title/scene boundaries, dark-theme ink, failure retry
and unchanged live plots/data. Export uses an isolated Plotly snapshot; model,
filter and camera controls remain editable in the app.

## Windows desktop dependency inputs

Windows CI and releases use CPython 3.11 x64 and two SHA256 input files. In a fresh
Windows environment, install the source-build tools first, then the runtime inputs:

```powershell
py -3.11 -m pip install --require-hashes --only-binary=:all: -r desktop/requirements-windows-build.lock
py -3.11 -m pip install --require-hashes --no-build-isolation --no-cache-dir --only-binary=:all: --no-binary=proxy-tools -r desktop/requirements-windows.lock
py -3.11 -m pip check
py -3.11 desktop/build_exe.py Core Assay Resource
```

The runtime file retains the 14 resolved package versions recorded with v3.1.0
and adds the explicit `setuptools` dependency required by PyInstaller. The build
file pins `setuptools`, `wheel` and wheel's `packaging` dependency; shared entries
have identical versions/hashes. Together they cover 16 distinct package inputs.
Hashes come from the published PyPI artifacts compatible with Windows x64 and
CPython 3.11. `proxy-tools` 0.1.0 is published only as source, so its verified source
archive is the single exception to wheel-only installation. `--no-build-isolation`
uses the already locked tools instead of fetching an independent build backend.
`--no-cache-dir` prevents reuse of a source-built wheel from an older backend.

An update requires reviewing PyPI release metadata, advisories, every compatible
artifact hash and dependency markers/constraints, then running Windows CI. Do not
replace a hash merely to accept modified bytes. Cross-platform wheel downloads
and an offline source build help verify inputs; they do not certify a Windows
install, native GUI or byte-for-byte EXE reproducibility. These files do not lock
CPython, pip, Windows, WebView2 or OS DLLs. `PYTHON-DEPENDENCIES.txt` remains a record
of the actual release environment. Mac/Linux keep `desktop/requirements.txt` and
the existing local web/PWA workflow.

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

Core and direct four-table Assay imports share prepared minimum-curvature arc positions. Keep raw surveys untouched; conflicting same-depth or opposite directions require source correction. Assumed starts and final-direction extensions belong in the project/report record. Supplied midpoint coordinates do not establish interval endpoints or a geological solid. Assay composites exported from midpoint-only input still interpolate between those midpoints; full trace/solid transport is a later integration step.

Nearest-neighbour estimates resolve numerically equal normalized distances (within 1e-10) by the lower source index. Preserve deterministic ties without changing the IDW/kriging weights. Test corrected same-name CSV reimports through actual file selection, alongside independent curved-trace answers, source preservation and project reopen. The Core training and shared Domain/search known-answer suites cover these contracts.

The unintegrated Domain S2 owners are `src/shared/geom/primitives.js` and `solid.js`. They do not add a fourth app or a Domain navigation action. `node tests/known-answer/domain-geometry.mjs` tests orthonormal section coordinates, polygon simplicity/area, hull-bounded TINs, self-intersection rejection and independent point-in-solid answers. Optional local `python tests/known-answer/domain-tin-oracle.py` requires NumPy/SciPy and compares actual source with Qhull; Linux CI runs it. Those Python packages are test dependencies, not app dependencies.

Geometry contracts: XYZ and planes use metres and doubles; polygons use XY or local section coordinates. TIN supports at most 2,000 unique contact locations, rejects conflicting heights at identical XY, records max-edge removals and returns null outside retained triangles. Prepared polygon/TIN queries copy their data; the TIN spatial index changes lookup cost only. Solid validation supports one closed positive shell, verifies edge/vertex manifold and triangle intersections with a bounded spatial search, and returns `inside`, `outside` or `boundary` (default tolerance 1e-8 m). Multiple shells/cavities are explicitly unsupported at this stage. `prepareTIN` is a query helper for triangles returned by the build owner, not validation of an imported overlapping triangulation. These contracts do not establish topography, geological honouring, overlap precedence or Resource partial-cell volume. Integrating them into an app requires actual browser/upload/export tests; pure Node results do not certify UI performance.

### UI and teaching-data regression coverage

The action/disclosure and Core exercise suites own isolated local servers:

```bash
python tests/test_action_hierarchy.py
python tests/test_core_training.py
python tests/test_mobile_tour.py
```

They exercise real Chromium pages, editable settings, keyboard disclosure, mobile overflow, plot layout, missing vs zero grades, and ZIP → CSV upload → validation → corrected re-upload. Run `python tests/test_module_handoff.py` with all modules on port 8767 to verify rows and density between phases. These tests supplement the independent numerical and report suites; a build alone does not certify a screening result.


Security reports belong through the private channel in [SECURITY.md](../SECURITY.md). For input examples, prefer synthetic or anonymised data. Public issues and PR attachments are visible to everyone.

The guided Assay workflow and native PDF interpretation ledger are exercised by
`python tests/test_assay_workflow.py`, including an actual upload/download, edited
controls, stale reviews, long-note pagination and a mobile viewport.

Run `python tests/test_screening_navigation.py` for the common dashboard,
Advanced sidebar, top stage controls, custom variogram calculation, optional
diagnostics, report-button revisits and EN/ID mobile layouts. This opens a real
browser. `test_core_training.py` validates the imperfect default, downloads original source CSVs and verifies corrected reimport. `test_mobile_tour.py` starts fresh and checks phone/tablet navigation, all EN/ID tour steps, dialog bounds/focus, resize/landscape and raw-data preservation. It retains the actual tour overlay.

Run `python tests/test_screening_reports.py` for native PDF/PNG downloads,
four-card executive hierarchy, EN/ID text, page bounds/bookmarks, readable
structured audit fields and independent selected-tonnage/grade/metal answers.
The test also checks missing grades, tiny values, no estimate and preservation
of the actual cutoff, confidence filter and existing grade-tonnage curve.

The Core validation-resolution test uses fresh desktop/phone sessions and normal UI actions: known-source confirmation/cancellation, four-CSV upload, exact row/cell links, verified record Add/Apply, ID and measurement correction, Desurvey/Merge, native PDF/project export and actual project reopen. The swallowed-render detector has a live canary. `OREBIT_TEST_DIST` replays an immutable prior artifact for regression controls; it does not bypass app actions.

## Browser safety and release verification

Browser libraries are bundled for offline operation. `build/vendor-lock.json`
records the reviewed versions, byte hashes and upstream npm archive integrity.
The build verifies all four files before creating output; a same-size modified
asset is rejected. An upgrade requires authoritative upstream verification,
licence/advisory review and native PDF/PNG/offline regressions. Do not edit the
lock merely to accept damaged bytes. Installed-app shell updates keep the prior
working worker until all replacement assets validate; project storage is retained.

The shared UI owner controls dialog and stage focus. Enter activates the focused
choice, including Cancel; undisclosed Advanced tools do not receive arrow-key
focus. Imported names remain analytical values and render as plain text.
Relevant browser regressions are `test_accessibility_keyboard.py`,
`test_resource_input_security.py`, `test_resource_large_extent.py` and
`test_pwa_install.py` under `tests/`; they use temporary servers and synthetic
inputs. Run the build first and use the documented Playwright installation.
The large-upload regression verifies the actual150k-row Assay export→Resource
import/grid path, full data retention, units and independent bounds.

Release-only `build/verify-release-source.py --tag vX.Y.Z` requires GitHub
repository/read authentication supplied by the workflow. Before Windows build
or publication it verifies tag/package version, exact commit, reviewed main
ancestry and successful trusted CI for that commit. Local source-ZIP development
and ordinary builds do not require release authentication. Existing release
assets remain immutable; publish changed tested code under a deliberate new tag.
