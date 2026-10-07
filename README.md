# Orebit GeoSuite

[![CI](https://github.com/ghoziankarami/geosuite/actions/workflows/ci.yml/badge.svg)](https://github.com/ghoziankarami/geosuite/actions/workflows/ci.yml)
[![GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-blue)](LICENSE)

**Core → Assay → Resource:** validate drillhole data, review grades and composites,
then estimate a preliminary block model. Free, open source, English and Bahasa Indonesia.
No account, licence key, or paid feature is required.

## Start here / Mulai di sini

| Your goal / Tujuan | Route / Langkah |
| --- | --- |
| Use the app now | [Open Core](https://geosuite.orebit.id/try/Core.html). You do not need to install Node or Python. |
| Use Windows executables | [Download Core, Assay and Resource from Releases](https://github.com/ghoziankarami/geosuite/releases/latest), then follow [Windows installation](docs/INSTALLATION.md#windows-executables). |
| Run or modify the open-source code | Follow the [source installation](#run-from-source) below. Windows, macOS and Linux are supported for the local web build. |
| Learn the workflow | Start with the [tutorial chooser](docs/vignettes/README.md); import the tutorial's own files for reproducible results. |
| Report a bug or contribute | Read [CONTRIBUTING.md](CONTRIBUTING.md). No private repository access is required. |

Bahasa Indonesia: untuk langsung memakai aplikasi, buka Core. Untuk memodifikasi
kode, clone atau unduh ZIP source lalu build. ZIP source berbeda dari executable
Windows: jangan mencari `.exe` di **Code → Download ZIP**.

## First successful workflow

1. **Core:** load the four drillhole tables (collar, survey, assay, geology), review
   automatic column matches or assign columns manually, inspect validation,
   then desurvey/merge and export the master CSV.
2. **Assay:** import that master, select the element and its unit, inspect
   distributions and missing values, justify domains/treatment, composite and
   export the estimation master.
3. **Resource:** import the estimation master, choose domain and element, inspect
   variography, set block geometry/density/search, estimate, validate and review
   grade–tonnage. Export results, plots and the PDF insight report.

Read the [input format and units](docs/DATA-FORMAT.md) before importing your own
files. Nonstandard headers use manual column assignment; a missing value is not
zero. Keep backups of CSVs and project exports between modules.

For the easiest training run, use the [10-minute quickstart](docs/vignettes/en/00-quickstart.md)
([Bahasa Indonesia](docs/vignettes/00-quickstart.md)) **when your build shows the
350-hole synthetic nickel sample**. For real uploaded data and detailed decisions,
use [Thalanga](docs/vignettes/en/01-thalanga-vms.md)
([Bahasa Indonesia](docs/vignettes/01-thalanga-vms.md)) or
[Babbitt](docs/vignettes/en/02-babbitt-cuni.md)
([Bahasa Indonesia](docs/vignettes/02-babbitt-cuni.md)).

Hosted apps, source and Windows releases can have different revisions. Check the
version and sample name/count in the app; an older Thalanga sample is not the
nickel quickstart. Download and upload the [training CSVs](https://github.com/ghoziankarami/orebit-datasets/blob/main/docs/USE_WITH_GEOSUITE.md)
when you need the same inputs across builds.

## Run from source

Install **Node.js 18+** and **Python 3.9+**. Git is needed for cloning; alternatively
use **Code → Download ZIP**, extract it, and open a terminal in the directory
containing `package.json`.

```bash
git clone https://github.com/ghoziankarami/geosuite.git
cd geosuite
npm run build
python3 -m http.server 8767 --bind 127.0.0.1 -d dist
```

On Windows PowerShell, replace the last command with:

```powershell
py -3 -m http.server 8767 --bind 127.0.0.1 -d dist
```

Open **http://127.0.0.1:8767/Core.html**. You should see the Core dashboard and
sample data; choose **Import** to use your own files. Assay and Resource are at
`/Assay.html` and `/Resource.html` on the same address. Keep the terminal open;
**Ctrl+C** stops the server. The web build uses bundled dependencies, so it has
**no `npm install` step**.

Serve generated **`dist/`**. Source **`phases/`** files contain build markers and
are not directly runnable. Keep `vendor/` and offline assets with the built modules.
The [installation guide](docs/INSTALLATION.md) covers portable bundles, offline
use, updates and troubleshooting.

## Develop and contribute

```bash
npm run build
npm test
```

These checks do not open a browser. Browser and calculation changes need the
additional checks in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), with independently
calculated expected values and uploaded data. Read [CONTRIBUTING.md](CONTRIBUTING.md)
before opening a PR. Use synthetic/anonymised fixtures in public reports.

| Path | Purpose |
| --- | --- |
| `phases/` | Canonical module markup and logic in this public tree. |
| `src/shared/` | Shared calculation, import, report and interface helpers. |
| `src/locales/`, `src/assets/`, `src/pwa/` | Languages, samples, fonts and offline support. |
| `build/`, `desktop/` | Web build and Windows packaging. |
| `tests/` | Numerical, import, browser and offline tests. |
| `docs/` | Tutorials, input format, methods and contributor guidance. |
| `vendor/` | Bundled libraries with their separate licence notices. |
| `dist/` | Generated output; ignored by Git. |

Maintainers also export selected canonical paths from a private development
repository. They carry accepted public changes back before the next export.
Contributors can clone, build, test and submit a PR entirely in this public repo.

## Offline use, reports and limitations

For an installed web app, open all three modules online before going offline.
Chrome/Edge/Chromium provide **Install app**; Safari on macOS 14+ provides
**File → Add to Dock**. Export project backups before clearing browser storage.
Optional Drive access, basemaps and update checks contact external services;
see the [privacy policy](https://geosuite.orebit.id/privacy/).

PDFs provide initial screening insight, effective parameters and review questions.
They do not certify a Mineral Resource or reserve. Geology, density, QA/QC,
metallurgy, economics and Competent Person review remain necessary for reporting
under KCMI/JORC. Read [methodology and limitations](docs/METHODOLOGY.md).

[Report a bug](https://github.com/ghoziankarami/geosuite/issues/new?template=bug-report.md) ·
[Report wrong numbers](https://github.com/ghoziankarami/geosuite/issues/new?template=wrong-numbers.md) ·
[Security reports](SECURITY.md) · [Orebit guides](https://orebit.id/docs.html)

## Licence and attribution

[GPL-3.0-only](LICENSE). Sample data and bundled libraries retain their own
licences and credit in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
[CITATION.cff](CITATION.cff) provides citation metadata.
Contact: <support@orebit.id>.
