# Orebit GeoSuite

[![CI](https://github.com/ghoziankarami/geosuite/actions/workflows/ci.yml/badge.svg)](https://github.com/ghoziankarami/geosuite/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/ghoziankarami/geosuite?label=release)](https://github.com/ghoziankarami/geosuite/releases/latest)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

**Free, open-source tools for drillhole data, assay analysis, and preliminary resource-estimation screening.** GeoSuite has three connected modules, available in English and Bahasa Indonesia. You can use the web app without an account, install it for offline use, or download a Windows desktop executable.

**[Open GeoSuite](https://geosuite.orebit.id/Core.html)** · **[Start the tutorial](https://geosuite.orebit.id/tutorials/)** · **[Windows downloads](https://github.com/ghoziankarami/geosuite/releases/latest)** · **[Bahasa Indonesia](#panduan-singkat-bahasa-indonesia)**

> GeoSuite provides a screening estimate and data-preparation workflow. It does not classify a Mineral Resource. Public reporting under KCMI/JORC requires a Competent Person. Read the [methodology and limitations](docs/METHODOLOGY.md).

## Start here

1. **Open [GeoSuite Core](https://geosuite.orebit.id/Core.html).** Use the built-in sample to explore, or import your own collar, survey, assay, and lithology tables.
2. **Check and export your data in Core.** Continue with [Assay](https://geosuite.orebit.id/Assay.html) for statistics, domains, compositing, and variography.
3. **Continue with [Resource](https://geosuite.orebit.id/Resource.html)** for an initial block-model estimate and grade–tonnage screening. Export project files to keep your own backup.

The [Thalanga tutorial](docs/vignettes/en/01-thalanga-vms.md) walks through all three modules with public data. The [data-format guide](docs/DATA-FORMAT.md) explains imports, units, and column names.

| Module | Main tasks |
| --- | --- |
| [Core](https://geosuite.orebit.id/Core.html) | Import and validate drillhole tables, desurvey, QA/QC, export clean data. |
| [Assay](https://geosuite.orebit.id/Assay.html) | Explore grades and domains, top-cut, decluster, composite, model variograms. |
| [Resource](https://geosuite.orebit.id/Resource.html) | Build a block model; screen estimates with kriging, IDW, or nearest neighbour. |

Geological files are processed locally in your browser or desktop app. Optional Google Drive opening and satellite basemap tiles use external services when you choose them; the site also checks for updates. See the [privacy policy](https://geosuite.orebit.id/privacy/) for details. There is no account, licence key, trial, or paid tier.

## Install and work offline

| Platform | What to do |
| --- | --- |
| Mac | Open a module in Safari and use **File → Add to Dock** (macOS 14+), or use **Install app** in Chrome/Edge. |
| Linux / ChromeOS | Open a module in Chrome, Edge, or Chromium and choose **Install app**. |
| Windows | Install the web app in Chrome/Edge, or download the **Core**, **Assay**, or **Resource** `.exe` from [GitHub Releases](https://github.com/ghoziankarami/geosuite/releases/latest). Each module is a separate executable; there is no ZIP to extract. |

Open all three modules at least once while online to cache them for offline use. Keep exported project files as backups; browser storage can be cleared by browser settings. Windows EXEs are unsigned, so verify that your download came from this repository's Releases page and compare it with the release's `SHA256SUMS.txt`.

## Build from source

Requirements: **Node.js 18+** and **Python 3.9+**. The web build has no npm package installation step. `npm run build` creates a complete `dist/` directory, including the bundled vendor libraries.

```bash
git clone https://github.com/ghoziankarami/geosuite.git
cd geosuite
npm run build
python3 -m http.server 8767 -d dist
```

Open `http://localhost:8767/Core.html` (or `Assay.html` / `Resource.html`). If you downloaded **Source code (zip)** instead of cloning, extract it, open a terminal in the extracted `geosuite-main` folder, and run the same `npm run build` and server commands. On Windows PowerShell, use `py -3 -m http.server 8767 -d dist` or `python -m http.server 8767 -d dist` for the server. The build accepts either `py -3` or `python` (Python 3.9+). Do not open `phases/*.html` directly: they contain build markers; use the generated files in `dist/` through the local server.

Run the fast, dependency-free tests with `npm test`. The [CI workflow](.github/workflows/ci.yml) also builds all modules, runs browser-based known-answer tests, verifies the tutorials, and checks offline installation. For the full local commands and where to edit code, see [Development guide](docs/DEVELOPMENT.md).

## Find your way around the repository

| Path | Purpose | Edit? |
| --- | --- | --- |
| `phases/{Core,Assay,Resource}.html` | Source markup and module-specific logic. | Yes |
| `src/shared/`, `src/locales/`, `src/assets/`, `src/pwa/` | Shared calculations and UI, EN/ID text, sample assets, offline app. | Yes |
| `build/build.mjs`, `build/patchers/` | Inlines sources and builds the three runnable HTML files. | When changing the build |
| `desktop/` | Windows pywebview wrapper, PyInstaller build and EXE verification. | For desktop changes |
| `tests/`, `docs/vignettes/` | Known-answer, browser, offline and tutorial checks. | With behaviour changes |
| `docs/` | [Manual](docs/manual/index.html), [methodology](docs/METHODOLOGY.md), [input format](docs/DATA-FORMAT.md), tutorials and this [development guide](docs/DEVELOPMENT.md). | Yes |
| `vendor/` | Bundled third-party libraries; see [notices](THIRD_PARTY_NOTICES.md). | Only with licence and version review |
| `dist/` | Generated web output; created by the build and ignored by Git. | No |

The public repository is the place for issues, source review, pull requests, and releases. Some product paths are currently exported from the maintainer's private development repository. Maintainers carry accepted public changes back to those source paths before the next export, as explained in [CONTRIBUTING.md](CONTRIBUTING.md). Contributors can work entirely from this public repository.

## Contribute and report problems

- Found a wrong grade, tonnage, or statistic? Use the [wrong-numbers issue template](https://github.com/ghoziankarami/geosuite/issues/new?template=wrong-numbers.md) with the smallest reproducible **synthetic or anonymised** CSV and an independently calculated expected value.
- Found a crash or import problem? Open a [bug report](https://github.com/ghoziankarami/geosuite/issues/new?template=bug-report.md) with module, version, steps, and browser/Windows details.
- Want to change code or documentation? Read [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), then open a PR. Update English and Indonesian UI text together where relevant.
- Found a vulnerability? Follow [SECURITY.md](SECURITY.md) and report it privately, not in a public issue.

Before a pull request, run `npm run build` and `npm test`. Changes to calculations should include an independently derived known-answer test. The CI runs more extensive browser checks.

## Tutorials, methods and licences

- [Thalanga VMS: Core → Assay → Resource](docs/vignettes/en/01-thalanga-vms.md) ([Bahasa Indonesia](docs/vignettes/01-thalanga-vms.md))
- [Babbitt Cu-Ni workflow](docs/vignettes/en/02-babbitt-cuni.md) ([Bahasa Indonesia](docs/vignettes/02-babbitt-cuni.md))
- [Methodology and limitations](docs/METHODOLOGY.md) · [Input data format](docs/DATA-FORMAT.md) · [Online tutorials](https://geosuite.orebit.id/tutorials/)

GeoSuite is licensed under [GPL-3.0-only](LICENSE), including commercial use under that licence's terms. Bundled libraries and sample datasets retain their own licences and attribution in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The project has a [Code of Conduct](CODE_OF_CONDUCT.md). Development is supported by voluntary [donations](https://saweria.co/orebitindonesia); training and institutional support: <support@orebit.id>.

## Panduan singkat Bahasa Indonesia

**GeoSuite gratis dan open source** untuk validasi data lubang bor, analisis assay, dan skrining estimasi sumber daya awal. Hasilnya bukan klasifikasi Sumber Daya Mineral untuk pelaporan publik.

1. Buka [Core](https://geosuite.orebit.id/Core.html), coba data contoh atau impor tabel collar, survey, assay, dan litologi; periksa lalu ekspor datanya.
2. Buka [Assay](https://geosuite.orebit.id/Assay.html) untuk statistik, domain, top-cut, komposit, dan variogram.
3. Buka [Resource](https://geosuite.orebit.id/Resource.html) untuk model blok dan skrining estimasi. Simpan berkas proyek sebagai cadangan.

Di Mac/Linux/ChromeOS, pasang versi web melalui browser yang mendukung. Di Windows, gunakan versi web atau unduh `.exe` per modul dari [Releases](https://github.com/ghoziankarami/geosuite/releases/latest). Buka ketiga modul sekali saat online agar tersimpan untuk pemakaian offline. Data geologi diproses secara lokal; layanan pilihan seperti Google Drive dan peta satelit dijelaskan di [kebijakan privasi](https://geosuite.orebit.id/privacy/).

Mulai dari [tutorial Thalanga](docs/vignettes/01-thalanga-vms.md), baca [format data](docs/DATA-FORMAT.md) dan [metodologi](docs/METHODOLOGY.md). Untuk berkontribusi atau melaporkan kesalahan angka, lihat [CONTRIBUTING.md](CONTRIBUTING.md).
