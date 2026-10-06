# GeoSuite

[![CI](https://github.com/ghoziankarami/geosuite/actions/workflows/ci.yml/badge.svg)](https://github.com/ghoziankarami/geosuite/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ghoziankarami/geosuite)](https://github.com/ghoziankarami/geosuite/releases/latest)
[![GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-blue)](LICENSE)

GeoSuite contains three connected tools for drillhole validation, assay analysis,
and preliminary resource-estimation screening. The interface supports English
and Bahasa Indonesia.

[Open the web application](https://geosuite.orebit.id/try/Core.html) ·
[Tutorials](https://geosuite.orebit.id/tutorials/) ·
[Windows downloads](https://github.com/ghoziankarami/geosuite/releases/latest)

[Local installation from source](docs/INSTALLATION.md) ·
[Download training CSVs](https://github.com/ghoziankarami/orebit-datasets/blob/main/docs/USE_WITH_GEOSUITE.md) ·
[Orebit guides](https://orebit.id/docs.html)

## Workflow

| Module | Tasks |
| --- | --- |
| [Core](https://geosuite.orebit.id/try/Core.html) | Import collar, survey, assay, and lithology tables; validate, desurvey, and export. |
| [Assay](https://geosuite.orebit.id/try/Assay.html) | Review grades and domains, top-cut, decluster, composite, and model variograms. |
| [Resource](https://geosuite.orebit.id/try/Resource.html) | Build a block model and screen estimates using kriging, IDW, or nearest neighbour. |

Start with the [Thalanga tutorial](docs/vignettes/en/01-thalanga-vms.md)
([Indonesian version](docs/vignettes/01-thalanga-vms.md)).
The [data-format guide](docs/DATA-FORMAT.md) covers input columns and units.

The [10-minute quickstart](docs/vignettes/en/00-quickstart.md)
([Bahasa Indonesia](docs/vignettes/00-quickstart.md)) targets a newer build with
a 350-hole synthetic nickel-laterite sample. Source checkouts, Windows releases
and hosted modules may come from different revisions. Check the bundled sample
name and hole count first; older Thalanga builds should use the tutorial above.
Installing or refreshing a page does not synchronize those product versions.

GeoSuite supports preliminary screening. It does not assign a Mineral Resource
classification for public reporting. Review the
[methodology and limitations](docs/METHODOLOGY.md); reporting under KCMI/JORC
requires Competent Person review.

## Use and install

No account or licence key is required. Geological files are processed in your
browser or desktop application. Optional Google Drive access, satellite basemaps,
and update checks contact external services; see the
[privacy policy](https://geosuite.orebit.id/privacy/).

| Platform | Installation |
| --- | --- |
| macOS | Open a module in Safari and select **File → Add to Dock** on macOS 14+, or install through Chrome/Edge. |
| Linux / ChromeOS | Open a module in Chrome, Edge, or Chromium and select **Install app**. |
| Windows | Install through Chrome/Edge, or download separate Core, Assay, and Resource executables from [Releases](https://github.com/ghoziankarami/geosuite/releases/latest). |

Open all three modules while online before using the installed web application
offline. Export project files as backups: clearing browser storage can remove
saved projects. Windows executables are unsigned; compare downloads with the
release's `SHA256SUMS.txt`.

## Build from source

Requirements: Node.js 18+ and Python 3.9+. The web build uses bundled libraries;
there is no `npm install` step.

```bash
git clone https://github.com/ghoziankarami/geosuite.git
cd geosuite
npm run build
python3 -m http.server 8767 --bind 127.0.0.1 -d dist
```

Open `http://127.0.0.1:8767/Core.html`. The other modules are `Assay.html` and
`Resource.html`.

For a source ZIP, extract it and run the build and server commands from
`geosuite-main/`. On Windows PowerShell, use
`py -3 -m http.server 8767 -d dist` or `python -m http.server 8767 -d dist`.
Source files in `phases/` contain build markers: serve the generated `dist/`
directory rather than opening those files directly.

The [installation guide](docs/INSTALLATION.md) includes a complete portable
web ZIP, offline setup, version checks and troubleshooting.

## Develop and contribute

```bash
npm run build
npm test
```

These checks need no npm dependencies. Browser tests additionally use Python
Playwright and Chromium; instructions are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

| Path | Purpose |
| --- | --- |
| `phases/` | Module markup and logic. |
| `src/shared/` | Shared calculations and interface code. |
| `src/locales/`, `src/assets/`, `src/pwa/` | Translations, sample assets, and offline application support. |
| `build/` | Build script and patchers. |
| `desktop/` | Windows wrapper and packaging. |
| `tests/` | Numerical, import, browser, and offline checks. |
| `docs/` | [Manual](docs/manual/index.html), methods, tutorials, and development guidance. |
| `vendor/` | Bundled dependencies with separate licence notices. |
| `dist/` | Generated output, ignored by Git. |

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
Use synthetic or anonymised examples in public issues. Calculation changes
should include an independently derived expected value. Update English and
Indonesian interface text together.

Some source paths are also maintained in a private development repository.
The maintainer carries accepted public changes back before the next export;
contributors can build, test, and submit changes entirely from this repository.

Report [bugs](https://github.com/ghoziankarami/geosuite/issues/new?template=bug-report.md),
[numerical discrepancies](https://github.com/ghoziankarami/geosuite/issues/new?template=wrong-numbers.md),
or follow [SECURITY.md](SECURITY.md) for private security reports.

## Tutorials and reference

- [Thalanga VMS](docs/vignettes/en/01-thalanga-vms.md) · [Bahasa Indonesia](docs/vignettes/01-thalanga-vms.md)
- [Babbitt Cu-Ni](docs/vignettes/en/02-babbitt-cuni.md) · [Bahasa Indonesia](docs/vignettes/02-babbitt-cuni.md)
- [Methodology](docs/METHODOLOGY.md) · [Input format](docs/DATA-FORMAT.md)
- [Development guide](docs/DEVELOPMENT.md)

## License and citation

GeoSuite is licensed under [GPL-3.0-only](LICENSE). Third-party libraries and
sample data retain the licences and attribution listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Citation metadata is in [CITATION.cff](CITATION.cff).
Support: <support@orebit.id>.

## Ringkasan Bahasa Indonesia

Gunakan **Core** untuk memeriksa data bor, **Assay** untuk analisis dan komposit,
lalu **Resource** untuk skrining model blok. Aplikasi tersedia melalui browser
dan sebagai executable Windows. Simpan ekspor proyek sebagai cadangan.

Mulai dari [tutorial Thalanga](docs/vignettes/01-thalanga-vms.md).
Hasil skrining tidak menggantikan klasifikasi sumber daya atau pemeriksaan
Competent Person untuk pelaporan publik.
