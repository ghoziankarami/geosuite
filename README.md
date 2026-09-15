<div align="center">

# ⛏️ Orebit GeoSuite

**Drillhole data preparation · EDA · Resource estimation — 100% offline Windows EXE**

[![Version](https://img.shields.io/badge/version-2.9.4-0d9488?style=flat-square)](https://github.com/ghoziankarami/geosuite/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-0078d6?style=flat-square&logo=windows&logoColor=white)](https://github.com/ghoziankarami/geosuite)
[![Offline](https://img.shields.io/badge/offline-first-brightgreen?style=flat-square)]()
[![License](https://img.shields.io/badge/free-forever-5980a6?style=flat-square)]()
[![Standards](https://img.shields.io/badge/SNI%204726%3A2019-KCMI%20%E2%80%A2%20JORC-orange?style=flat-square)]()

**Geological data workflows built for mineral exploration — from raw drillhole CSV to resource-ready output, fully offline.**

![Multivariate Analysis](assets/s4.png)

</div>

---

## 📦 What is GeoSuite?

Orebit GeoSuite is a **geologist-first toolkit** for mineral exploration data. It runs **100% offline** — perfect for field camps, sites without internet, and privacy-sensitive environments.

**Free to use, permanently** — web and Desktop Edition alike, no trial, no paywall. Sustained by voluntary [Support Orebit](https://saweria.co/orebitindonesia) contributions from users who find it valuable.

Workflows are aligned with **SNI 4726:2019, KCMI, and JORC** reference standards. Standards are
reference points, not a substitute for judgement: finalising a resource statement requires
independent Competent Person review.

| Module | Function |
|--------|----------|
| **Core** | Drillhole validation, desurvey, compositing, merge & export |
| **Assay** | EDA: statistics, top-cut, drill spacing, domaining |
| **Resource** | Variography, ordinary kriging, block model, grade-tonnage, preliminary confidence screening |
| **Bundle** | All three modules in one ZIP |

> **On classification.** Resource reports a *preliminary confidence* screen. That is
> not a Measured/Indicated/Inferred classification and is not a substitute for one —
> see [the docs](https://geosuite.orebit.id/docs/) for what the distinction means in practice.

> 💡 Try the **free web tools** at [geosuite.orebit.id/try/](https://geosuite.orebit.id/try/) — full features, no install, no signup.

---

## 🚀 Quick Start (2 steps)

**Step 1 — Double-click `Orebit-*.exe`**
- WebView2 Runtime auto-installs in the background (one-time)
- A free license key request prompt appears

**Step 2 — Request your free license key**
- Enter your email — a free, permanent key is sent instantly
- Paste the key → click **Activate** → done!

Activation is **once per machine**. After activation the app opens directly every time.

---

## 🖼️ Product Screenshots

### Core — Project Dashboard
![Core Dashboard](assets/s2.png)

### Assay — EDA Dashboard
![Assay EDA](assets/s1.png)

### Data Import
![Data Import](assets/s3.png)

### Multivariate Analysis
![Multivariate](assets/s4.png)

---

## 🔬 Workflow — 3 Stages

```
Stage 1 — Core      → validate + composite + desurvey drillhole
Stage 2 — Assay     → exploratory data analysis (EDA)
Stage 3 — Resource  → resource estimation (JORC/KCMI/SNI)
```

Read **`docs/Orebit-GeoSuite.pdf`** (included in every package) for the complete manual — CSV format for collar/survey/assay, parameter reference, and export guide.

---

## 📚 Learn it with real data

You do not need your own drillhole data to start. Everything below is free and openly licensed.

### Worked tutorial — epithermal gold, start to finish

**[From drillhole CSV to a grade-tonnage curve →](https://gist.github.com/ghoziankarami/957b05c882f57097441d9388c1e3fa5c)**

A complete run through all three modules on a synthetic epithermal gold vein:
validation → desurvey → compositing → EDA → top-cut → domaining → variography →
ordinary kriging → grade-tonnage. Every number in it is measured from the data,
and it ships with a **self-verification script** that recomputes all of them from
the raw CSVs so you can check the tutorial rather than trust it.

Decisions it walks through, with the actual trade-off numbers:

- why pooling domains reports **0.43 g/t** where the vein is **5.59 g/t** (13× apart)
- what a top-cut at 20 g/t really costs — **17.2% of the metal**
- why a downhole width of **7.50 m** is a true width of **5.40 m**, a 39% overstatement
- why an omnidirectional variogram on 30 m sections looks like pure nugget

### Open datasets

**[orebit-datasets →](https://github.com/ghoziankarami/orebit-datasets)** — three fully
synthetic drillhole datasets under **CC BY 4.0**, built around deposit styles that
matter in Indonesia. No licence ambiguity: every number was generated, so there is
no third party to ask.

| Dataset | Style | Grade CV | The estimation problem it poses |
|---|---|---|---|
| `01-emas-epitermal` | Low-sulphidation Au–Ag vein | **1.66** | Erratic high grades; top-cut and domaining decide the answer |
| `02-nikel-laterit` | Ni–Co laterite over ultramafic | **0.28** | Smooth layered regolith; the problem is horizon boundaries, not outliers |
| `03-timah-placer` | Alluvial cassiterite (kaksa) | **1.42** | Thin basal pay layer, volumetric grade in kg/m³ |

Same four-file layout (`collar` · `survey` · `assay` · `litho`) across all three, so a
workflow built on one runs on the others.

### Reference documentation

**[geosuite.orebit.id/docs →](https://geosuite.orebit.id/docs/)** — a 15-minute quickstart,
workflow guides (QA/QC, top-cut, variogram modelling, block size, estimation validation,
reporting), a full parameter reference for every control in all three modules, and concept
pages explaining *why* — why minimum curvature, what kriging variance is and is not, how to
read a swath plot.

---

## 📦 Package Layout

```
Orebit-{Module}-vX.Y.Z.zip
├── Orebit-Core.exe          ← double-click, ready to use
├── docs/
│   └── Orebit-GeoSuite.pdf
└── README.txt               ← guide + license
```

> WebView2 Runtime auto-installs on first run. No manual setup needed.

---

## 🆘 Troubleshooting

**Q: "Windows protected your PC" (SmartScreen)**
**A:** Click **More info** → **Run anyway**. New software without an EV certificate triggers this — normal and safe.

**Q: EXE opens no window at all**
**A:** WebView2 failed to auto-install. Fix:
1. Install manually: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
2. Choose **"Evergreen Standalone Installer"**
3. Run the EXE again

**Q: "Invalid key"**
**A:** (1) Ensure the key has no extra spaces. (2) Keys are case-sensitive. (3) Confirm the key matches the product (BNDL unlocks all modules). (4) Contact orebit.id@gmail.com if it still fails — free replacement keys are sent on request.

**Q: Does it run on Linux / Mac?**
**A:** The EXE is Windows-only. Use the full-featured web tools at [geosuite.orebit.id/try/](https://geosuite.orebit.id/try/) instead — they run on your own laptop, whatever the operating system.

---

## 📞 Contact & Support

- **Email**: [orebit.id@gmail.com](mailto:orebit.id@gmail.com)
- **Web**: [orebit.id](https://orebit.id) · [geosuite.orebit.id](https://geosuite.orebit.id)
- **Support hours**: 09:00–17:00 WIB (Mon–Fri)

---

## 📜 License

**Free, permanent license.** Core, Assay, and Resource are free to use — web and Desktop Edition alike — for personal and business work, with no trial period or expiry.

**NOT permitted:** Public redistribution, or reselling access to the EXE/key.

Orebit GeoSuite is sustained by voluntary, open-amount support from users who find it valuable — see [Support Orebit](https://saweria.co/orebitindonesia). This is entirely optional and not required to use the software.

For team / company / multi-seat deployments, contact [orebit.id@gmail.com](mailto:orebit.id@gmail.com).

---

<div align="center">

© 2026 [Orebit](https://orebit.id) · Free to use · Built by [Ghozian Islam Karami](https://github.com/ghoziankarami)

</div>
