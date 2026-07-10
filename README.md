# Orebit GeoSuite

**Drillhole data preparation, EDA, dan resource estimation — 100% offline Windows EXE.**

Orebit GeoSuite adalah toolkit geologi tambang untuk eksplorasi mineral. Seluruh modul berjalan **fully offline** — cocok untuk field camp, daerah tanpa internet, dan lingkungan data sensitif.

---

## 📦 Package

```
Orebit-{Module}-vX.Y.Z.zip
├── Orebit-Core.exe          ← double-click, langsung pakai
├── docs/
│   └── Orebit-GeoSuite.pdf
└── README.txt               ← panduan + lisensi
```

| Module | Fungsi |
|--------|--------|
| **Core** | Drillhole validation, composite, desurvey, export |
| **Assay** | EDA: statistik, top-cut, domaining, estimasi tonase |
| **Resource** | Variografi, kriging ordinary, klasifikasi sumber daya |
| **Bundle** | Semua modul dalam satu ZIP — unlock dengan 1 key (BNDL) |

> WebView2 Runtime otomatis terinstall saat EXE pertama dijalankan. Tidak perlu install manual.

---

## 🚀 Cara Pakai (Cuma 2 Langkah)

**Langkah 1** — Double-click `Orebit-*.exe`
- WebView2 Runtime auto-install (proses latar, sekali)
- Muncul dialog aktivasi lisensi

**Langkah 2** — Masukkan license key dari email
- Copy key (format `OREBIT3.xxx...`)
- Paste → klik **Activate** → selesai!

Setelah aktivasi, aplikasi langsung terbuka. Run berikutnya langsung masuk — aktivasi hanya **sekali per komputer**.

---

## 📚 Workflow 3 Tahap

```
Tahap 1 — Core      → validasi + composite + desurvey drillhole
Tahap 2 — Assay     → exploratory data analysis (EDA)
Tahap 3 — Resource  → resource estimation (JORC/KCMI/SNI)
```

Baca **`docs/Orebit-GeoSuite.pdf`** untuk panduan lengkap — format CSV collar/survey/assay, parameter setiap fitur, dan cara ekspor hasil.

---

## 🆘 Troubleshooting

**Q: "Windows protected your PC" (SmartScreen)**
A: Klik **More info** → **Run anyway**. Software baru tanpa sertifikat EV — normal, tidak berbahaya.

**Q: EXE tidak muncul jendela apapun**
A: WebView2 gagal auto-install. Solusi:
1. Download & install manually: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
2. Pilih "Evergreen Standalone Installer"
3. Jalankan EXE lagi

**Q: "Invalid key"**
A: (1) Pastikan key utuh tanpa spasi ekstra. (2) Key case-sensitive. (3) Pastikan key sesuai produk (BNDL unlock semua modul). (4) Hubungi hello@orebit.id jika masih gagal.

**Q: Bisa dipakai di Linux / Mac?**
A: EXE hanya untuk Windows. Gunakan versi web di [geosuite.orebit.id/try/](https://geosuite.orebit.id/try/) — fitur lengkap, browser modern.

---

## 📞 Kontak & Bantuan

- **Email**: hello@orebit.id
- **Web**: [orebit.id](https://orebit.id) | [geosuite.orebit.id](https://geosuite.orebit.id)
- **Support**: 09:00–17:00 WIB (Senin–Jumat)

---

## 📜 Lisensi

**Single-purchase, lifetime license.** Pembeli asli berhak menggunakan untuk pekerjaan internal maupun proyek konsulting pribadi.

**TIDAK DIIZINKAN:** Menjual kembali, membagikan ke publik, atau mengunggah EXE/key ke repositori publik, forum, atau layanan file sharing.

Untuk lisensi tim / perusahaan / multi-seat, hubungi hello@orebit.id.

---

© 2026 [Orebit.id](https://orebit.id) · Single-purchase license
