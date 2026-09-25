# Third-party components

GeoSuite is GPL-3.0. It bundles the following components under their own licences,
all compatible with GPL-3.0. Their licence headers are kept intact in the files.

| Component | Version | Licence | File | Source |
|---|---|---|---|---|
| plotly.js | 2.32.0 | MIT | `vendor/plotly.min.js` | https://github.com/plotly/plotly.js |
| jsPDF | 4.2.0 | MIT | `vendor/jspdf.umd.min.js`, `vendor/jspdf.min.js` | https://github.com/parallax/jsPDF |
| html2canvas | 1.4.1 | MIT | `vendor/html2canvas.min.js` | https://github.com/niklasvh/html2canvas |
| JSZip | 3.10.1 | MIT or GPL-3.0 (used under MIT) | `vendor/jszip.min.js` | https://github.com/Stuk/jszip |
| Inter (font) | — | SIL Open Font License 1.1 | `src/assets/fonts/*.face.css` | https://github.com/rsms/inter |

# Data

| Data | Where | Licence and attribution |
|---|---|---|
| Thalanga VMS drilling (collar, survey, assay, geology) | `src/assets/sample/core.json` (Core's built-in sample), and the Assay/Resource samples derived from it; tutorial 01 | © State of Queensland (Geological Survey of Queensland), *NEQ Deposit Atlas – Thalanga*, dataset ds100103, <https://geoscience.data.qld.gov.au/dataset/ds100103>, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Loaded as published; GeoSuite converts laboratory codes on import (documented in docs/METHODOLOGY.md). Tutorial 01 blanks one Au value and deletes two duplicate spot samples, recorded in its text. |
| `docs/vignettes/data/thalanga-deposit-area.geojson` | tutorial 01 | Made for this project; GPL-3.0 with the rest of the repository. |
| Babbitt Cu-Ni drilling | **not included** — `docs/vignettes/tools/run_babbitt.py` downloads it | Natural Resources Research Institute, University of Minnesota Duluth — Duluth Complex drill-hole database (NRRI/TR-2003/21), as distributed with [pygslib](https://github.com/opengeostat/pygslib) (© Adrian Martinez Vargas, MIT) in `doc/source/Tutorial_1/Babbitt`. Only numbers derived from it and screenshots are published here. |
| Synthetic tutorial datasets | [orebit-datasets](https://github.com/ghoziankarami/orebit-datasets) | Generated for this project, CC BY 4.0. |
