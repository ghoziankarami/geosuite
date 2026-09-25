# Orebit GeoSuite

**Drillhole data to a first resource estimate — free, offline, open source.**
Three connected tools for exploration geologists, in English and Bahasa Indonesia:

| Module | What it does |
|---|---|
| **Orebit Core** | Import collar / survey / assay / lithology tables (any column names, EN or ID headers), validate them, desurvey, QAQC, export a clean master file. |
| **Orebit Assay** | Statistics per element and domain, top-cut, declustering, automatic or manual domaining, compositing, variography. |
| **Orebit Resource** | Block model, ordinary kriging / IDW / nearest neighbour, cross-validation, a preliminary confidence screen (not a classification), grade–tonnage, contained metal, a reporting-readiness checklist and PDF report. |

Each module is a single self-contained tool that runs offline on your laptop: your
data never leaves your computer. No account, no trial, no paid tier.

**Try it:** [geosuite.orebit.id](https://geosuite.orebit.id) (loads with a sample dataset) ·
**Desktop (Windows):** [Releases](https://github.com/ghoziankarami/geosuite/releases) ·
**Tutorials on real data:** [docs/vignettes](docs/vignettes/README.md) ·
**Methodology:** [docs/METHODOLOGY.md](docs/METHODOLOGY.md) ·
**Input format:** [docs/DATA-FORMAT.md](docs/DATA-FORMAT.md) ·
**Manual:** [geosuite.orebit.id/docs](https://geosuite.orebit.id/docs/)

## Install

| Your computer | How |
|---|---|
| **Mac** | Open [geosuite.orebit.id/Core.html](https://geosuite.orebit.id/Core.html) in **Safari → File → Add to Dock** (macOS 14 Sonoma or later), or in Chrome/Edge click **Install app**. GeoSuite then opens from the Dock as its own app and works offline. |
| **Linux, ChromeOS** | Chrome/Edge/Chromium: **Install app** (button in the header, or the install icon in the address bar). |
| **Windows** | Same as above, or the Desktop Edition from [Releases](https://github.com/ghoziankarami/geosuite/releases). |
| **No internet at all / your own server** | `node build/build.mjs && cp -r vendor dist/` and serve `dist/` from any static web server — it is a complete installable app. |

The installed app caches all three modules on first launch; updates arrive the next time
it opens with a connection. Your data stays on your computer either way.

> GeoSuite is a screening and data-preparation tool. Its output is not a Mineral
> Resource classification; public reporting under KCMI 2017 / JORC 2012 needs a
> Competent Person. See [METHODOLOGY.md](docs/METHODOLOGY.md#methodology--what-geosuite-computes-and-what-it-does-not).

## Learn it with real data

| Tutorial | Data | What it teaches |
|---|---|---|
| [01 — Thalanga VMS](docs/vignettes/en/01-thalanga-vms.md) · [ID](docs/vignettes/01-thalanga-vms.md) | Geological Survey of Queensland, CC BY 4.0 (the built-in sample) | lab codes, validation with an audit trail, cropping a regional compilation, populations vs outliers, grade-shell domaining without lithology, why defaults gave 276 Mt, a check against 1989–1998 production |
| [02 — Babbitt Cu-Ni](docs/vignettes/en/02-babbitt-cuni.md) · [ID](docs/vignettes/02-babbitt-cuni.md) | NRRI Duluth Complex database via pygslib | files in feet, 61 % of the core never assayed, a justified top-cut, dense data and smoothing, estimate vs an RPEEE-constrained resource |

Every number in these tutorials is produced by a script that drives the real app
(`docs/vignettes/tools/`), re-derived independently, and re-checked by
`tests/test_vignettes.py` — the text cannot silently disagree with the software.

More:

- **[Epithermal gold, start to finish](https://gist.github.com/ghoziankarami/957b05c882f57097441d9388c1e3fa5c)** —
  all three modules on a synthetic vein, with a self-verification script: why pooling
  domains reports 0.43 g/t where the vein is 5.59 g/t, what a 20 g/t top-cut costs
  (17.2 % of the metal), why a 7.50 m downhole width is 5.40 m true width.
- **[orebit-datasets](https://github.com/ghoziankarami/orebit-datasets)** — three synthetic
  drillhole datasets under CC BY 4.0, same four-file layout:

  | Dataset | Style | Grade CV | The problem it poses |
  |---|---|---|---|
  | `01-emas-epitermal` | Low-sulphidation Au–Ag vein | 1.66 | erratic high grades; top-cut and domaining decide the answer |
  | `02-nikel-laterit` | Ni–Co laterite over ultramafic | 0.28 | smooth layered regolith; horizon boundaries, not outliers |
  | `03-timah-placer` | Alluvial cassiterite (kaksa) | 1.42 | thin basal pay layer, volumetric grade in kg/m³ |

## Why trust the numbers

- Every calculation, default and limit is written down in [METHODOLOGY.md](docs/METHODOLOGY.md).
- A known-answer test drives real CSV files through all three modules and re-derives
  desurvey, compositing, IDW, kriging (with its own independent solver), grade–tonnage
  and contained metal, then compares them with what the app reports.
- Two tutorials drive real public drillhole databases through the whole chain on every
  change (above). Building them found and fixed more than a dozen defects — no domain
  boundary in estimation (Thalanga 202 Mt → 3.7 Mt against 4.7 Mt mined), a variogram fit whose
  "60 % nugget" was the edge of its own search grid, samples stacked
  on a collar, duplicate composite coordinates, a cross-validation that found neighbours
  for 10 samples of 200, results that changed from run to run.
- Imports never drop or change data silently: every upload shows what was loaded,
  what was rejected and why, and every below-detection or missing-sample code that
  was converted.
- Found a wrong number? [Report it](https://github.com/ghoziankarami/geosuite/issues/new?template=wrong-numbers.md)
  — these reports are fixed first.

## Build from source

Requirements: Node.js ≥ 18 and Python ≥ 3.9 (for the build-time patchers). No npm packages.

```bash
node build/build.mjs            # builds dist/Core.html, dist/Assay.html, dist/Resource.html
npm test                        # fast known-answer and import tests (Node only)
```

Open `dist/Core.html` from a local web server (`python3 -m http.server -d dist`) —
the pages load `vendor/` scripts by relative path, so copy `vendor/` next to them
(`cp -r vendor dist/`).

Full browser test (Playwright + Chromium):

```bash
pip install playwright && playwright install chromium
cp -r vendor dist/
python3 -m http.server 8767 -d dist & python3 -m http.server 8768 -d dist & python3 -m http.server 8769 -d dist &
python3 tests/test_pipeline_known_answer.py
```

### Repository layout

```
phases/        Core.html, Assay.html, Resource.html — the application source (edit these)
src/shared/    code shared by all three modules (import, columns, grade codes, geostatistics, UI)
src/assets/    fonts and sample datasets, inlined at build time
src/locales/   English and Indonesian UI text
build/         build.mjs resolves the @orebit-inline markers, then runs the patchers
vendor/        third-party libraries (see THIRD_PARTY_NOTICES.md)
tests/         known-answer, browser and tutorial tests
docs/          methodology, data format, manual, tutorials (docs/vignettes)
```

`phases/*.html` contain `/* @orebit-inline: … */` markers and are **not runnable
before the build**. Always open the files in `dist/`.

## Troubleshooting (Windows Desktop Edition)

- **"Windows protected your PC" (SmartScreen):** *More info* → *Run anyway*, for a file
  from the official Releases page only. Or install through Chrome/Edge instead (no warning).
- **The EXE opens no window:** WebView2 did not install. Get the *Evergreen Standalone
  Installer* from [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
  and run the EXE again.
- **Older versions asked for a licence key.** From v3.0 there is none; download the
  current release.

## Contributing

Bug reports with a small CSV that reproduces them are the most valuable contribution.
See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## Support the project

GeoSuite is free. If it saves you time, you can support development with a donation of
any amount at [saweria.co/orebitindonesia](https://saweria.co/orebitindonesia).
Training and institutional support: support@orebit.id.

## License

GeoSuite is free software under the [GNU General Public License v3.0](LICENSE).
You may use, study, share and modify it; distributed modified versions must remain
under the GPL with their source available. Third-party components keep their own
licences — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## Bahasa Indonesia

**Dari data bor sampai estimasi sumber daya awal — gratis, offline, open source.**
Orebit Core (impor, validasi, desurvey, QAQC), Orebit Assay (statistik, top-cut,
declustering, domain, komposit, variogram) dan Orebit Resource (block model, kriging,
kurva grade–tonase, logam terkandung, laporan). Data Anda tidak pernah meninggalkan
laptop. Tanpa akun, tanpa trial, tanpa versi berbayar.

**Pasang di Mac:** buka [geosuite.orebit.id/Core.html](https://geosuite.orebit.id/Core.html) di Safari →
File → Add to Dock (macOS 14+), atau di Chrome/Edge klik **Install app**. GeoSuite lalu terbuka
dari Dock sebagai aplikasi sendiri dan bisa dipakai offline. Linux/ChromeOS: Chrome/Edge → Install app.
Windows: cara yang sama, atau Desktop Edition dari Releases.

Hasil GeoSuite adalah *screening* pra-estimasi, bukan klasifikasi sumber daya;
pelaporan publik KCMI 2017 / JORC 2012 tetap membutuhkan Competent Person. Semua
metode, parameter bawaan, dan batasannya tertulis di [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

**Tutorial dengan data nyata** (Bahasa Indonesia): [Thalanga](docs/vignettes/01-thalanga-vms.md) ·
[Babbitt](docs/vignettes/02-babbitt-cuni.md) — setiap angka diukur ulang dari aplikasi pada tiap perubahan.

Menemukan angka yang salah? [Laporkan](https://github.com/ghoziankarami/geosuite/issues/new?template=wrong-numbers.md)
dengan CSV kecil yang mereproduksinya — laporan seperti ini diprioritaskan.
Lisensi: GPL-3.0.
