# Development guide

This guide is for people changing GeoSuite from the public repository. You do not need access to the maintainer's private operations repository to report an issue, build the app, or submit a pull request.

## How the code becomes an app

```text
phases/*.html + src/shared + src/assets + src/locales
                 ↓ node build/build.mjs
            dist/{Core,Assay,Resource}.html
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
node build/build.mjs Core Assay Resource
cp -r vendor dist/
python3 -m http.server 8767 -d dist
```

Then open `http://localhost:8767/Core.html`. Windows PowerShell users can replace `cp -r vendor dist/` with `Copy-Item vendor dist/vendor -Recurse` and invoke `python` instead of `python3` where needed. Use a local HTTP server so module navigation and offline features run under a web origin.

For a module-specific change, edit the source in `phases/` or `src/`, rebuild, and verify the corresponding file in `dist/`. If the rule belongs in multiple modules, place it in `src/shared/` once. When changing user-visible text, update both EN and ID locale sources.

## Run tests

Fast checks require no npm dependencies:

```bash
npm test
```

To run the browser checks, install Playwright and Chromium for Python, build and copy `vendor/` as above, then start three local servers on ports 8767, 8768, and 8769. The test scripts use those separate origins for module handoff:

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
python3 -m http.server 8767 -d dist &
python3 -m http.server 8768 -d dist &
python3 -m http.server 8769 -d dist &
python3 tests/test_pipeline_known_answer.py
python3 tests/test_lab_conventions.py
python3 tests/test_estimation_inputs.py
python3 tests/test_module_handoff.py
python3 tests/test_pwa_install.py
python3 tests/test_vignettes.py
```

Stop the background servers afterward. `test_vignettes.py` drives tutorial workflows and may take longer or require access to the public tutorial datasets. The public [CI workflow](../.github/workflows/ci.yml) is the reference for the complete tested command sequence and environment.

For a numeric fix, add a small known-answer case with an independently calculated expected value. A test that calls the same calculation twice will not catch a wrong formula. For a UI or import fix, exercise the user path that was broken, including file upload when the bug only appears after upload.

## Send a change

1. Search [issues](https://github.com/ghoziankarami/geosuite/issues) and read [CONTRIBUTING.md](../CONTRIBUTING.md).
2. Change editable source, docs, and relevant tests. Do not commit `dist/`, secrets, customer data, or confidential drillhole files.
3. Build all three modules, run `npm test`, and run relevant browser checks. Describe the expected value and observed output for calculation changes.
4. Open a PR here. The maintainer records the matching change in the canonical development source before the next public export; you do not need that private checkout. See the PR template for carry-back status.

Security reports belong through the private channel in [SECURITY.md](../SECURITY.md). For input examples, prefer synthetic or anonymised data. Public issues and PR attachments are visible to everyone.
