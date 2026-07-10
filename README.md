# Orebit GeoSuite

**Drillhole data preparation, EDA, dan resource estimation — 100% offline Windows EXE.**

Orebit GeoSuite adalah toolkit geologi tambang untuk eksplorasi mineral. Seluruh modul berjalan **fully offline** — cocok untuk field camp, daerah tanpa internet, dan lingkungan data sensitif.

---

## 📦 Isi Package

| Item | Keterangan |
|------|-----------|
| `Orebit-Core.exe` | Drillhole validation, composite, desurvey, export |
| `Orebit-Assay.exe` | EDA: statistik, top-cut, domaining, KCMI auto-fill |
| `Orebit-Resource.exe` | Variografi, kriging ordinary, klasifikasi sumber daya |
| `MicrosoftEdgeWebview2Setup.exe` | WebView2 runtime installer (100 MB, sekali instal) |
| `docs/Orebit-GeoSuite.pdf` | Manual lengkap — workflow, format data, cara export |
| `sample-data/` | Dataset contoh (Thalanga VMS) untuk latihan |
| `LICENSE.txt` | Single-purchase license — baca sebelum aktivasi |

> **Catatan**: Tidak semua file di atas selalu ada di setiap package. Modul tunggal (Core / Assay / Resource) hanya berisi EXE terkait + WebView2 installer. Bundle berisi ketiganya.

---

## 🚀 Quick Start

### 1. Install WebView2 Runtime *(sekali saja)*
Windows 10/11 mayoritas sudah terinstall. Jika belum:
- **Otomatis**: Jalankan EXE GeoSuite — installer WebView2 muncul otomatis
- **Manual**: Klik kanan `MicrosoftEdgeWebview2Setup.exe` → Run as administrator
- **Download**: [Microsoft WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

### 2. Jalankan Aplikasi
1. Double-click `Orebit-*.exe` (pilih modul)
2. **SmartScreen warning**: Klik **More info** → **Run anyway** — normal untuk software baru
3. **Antivirus false positive**: Klik kanan `.exe` → Properties → centang **Unblock** → OK

### 3. Aktivasi License
1. EXE pertama kali terbuka → muncul **dialog aktivasi**
2. Buka email konfirmasi dari orebit.id (berisi license key)
3. Copy key (format `OREBIT3.xxx...yyy`)
4. Paste → klik **Activate**

Aktivasi **sekali per komputer**. Selanjutnya EXE langsung terbuka tanpa dialog.

---

## 📚 Workflow 3 Tahap

```
Tahap 1 — Orebit Core      →  validasi + composite + desurvey drillhole
Tahap 2 — Orebit Assay     →  exploratory data analysis (EDA)
Tahap 3 — Orebit Resource  →  resource estimation (KCMI/JORC/SNI)
```

Baca **`docs/Orebit-GeoSuite.pdf`** untuk panduan lengkap — format CSV collar/survey/assay, parameter setiap fitur, dan cara ekspor hasil.

---

## 🆘 Troubleshooting

**Q: "Windows protected your PC" (SmartScreen)**
A: Klik **More info** → **Run anyway**. Software independen biasanya belum sertifikat EV — tidak berbahaya.

**Q: EXE terbuka di browser**
A: WebView2 belum terinstall. Jalankan `MicrosoftEdgeWebview2Setup.exe` sebagai admin.

**Q: "Invalid key"**
A: (1) Pastikan key utuh tanpa spasi ekstra. (2) Key case-sensitive. (3) Pastikan key sesuai produk (BNDL unlock semua modul; CORE/ASAY/RSRC masing-masing). (4) Hubungi hello@orebit.id jika masih gagal.

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
