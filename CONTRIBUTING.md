# Contributing to Orebit GeoSuite

Thank you for helping. Geologists' bug reports are the most valuable contribution —
you do not need to write code.

## Reporting a problem

- **Wrong number** (a grade, tonnage, metal content or statistic you believe is wrong):
  use the *Wrong numbers* issue template. Attach the smallest CSV that shows it (make
  the coordinates and grades synthetic if the data is confidential), the module and
  version, and the value you expected with how you calculated it.
- **Bug or crash:** use the *Bug report* template; include the browser or Desktop
  version and the steps.
- **A file that will not import:** attach it (or its first 20 lines, anonymised). Every
  such file becomes a test case.

## Changing the code

1. `phases/*.html` and `src/` are the source. `dist/` is build output — never edit it.
2. Shared logic lives in `src/shared/` and is inlined into all three modules by
   `build/build.mjs`. If two modules need the same rule, put it there once.
3. **Test first.** A change in behaviour comes with a test that fails before the change
   and passes after it. For import or math changes, prefer a known-answer test (compute
   the expected value independently, by hand or in the test) over re-running the app's
   own code.
4. Run before opening a pull request:
   ```bash
   node build/build.mjs
   npm test
   ```
   and, for anything touching estimation, `tests/test_pipeline_known_answer.py`.
5. User-visible text goes in `src/locales/<module>/en.json` **and** `id.json`.
6. Never ship a price, trial or paywall — GeoSuite is free by design.
7. Describe *why* in the commit message (`fix(assay): …`, `feat(resource): …`).

By contributing you agree that your contribution is licensed under GPL-3.0.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
