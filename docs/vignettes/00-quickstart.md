# Mulai cepat: GeoSuite dalam 10 menit

Panduan ini untuk GeoSuite 3.2.0. Ketiga modul dibuka dengan proyek contoh laterit nikel sintetis (CC BY 4.0, kredit Orebit.id). Core memuat 349 collar dengan beberapa kesalahan data yang disengaja. Assay dan Resource memuat interval LIM/SAP yang sudah siap dari sumber lengkap 350 lubang. Contoh ini latihan, bukan data lapangan.

## 1. Core: periksa data bor (3 menit)

[Buka Orebit Core](https://geosuite.orebit.id/Core.html), lalu klik **Mulai review**. Tahap utama ada di sidebar: Impor, Validasi, Desurvey, Gabung, Domain, Ekspor. **Tools lanjutan** membuka tabel, strip log, dan penampang.

- **Dasbor** menampilkan 349 collar, 8.896 interval assay, 1.368 interval geologi, dan total kedalaman 8.796 m.
- **Validasi** mendaftar setiap temuan per lubang: collar hilang, survey hilang, interval tumpang tindih atau berlubang, dan ID yang tidak cocok. Desurvey terkunci sampai temuan yang menghambat selesai.
- **Perbaiki contoh:** klik **Unduh CSV sumber**, ekstrak, lalu impor keempat tabel aslinya dan validasi ulang. Cara ini hanya untuk sumber sintetis.
- **Desurvey** menghitung lintasan 3D tiap lubang. **Gabung** menyatukan collar, survey, assay, dan geologi menjadi satu tabel master.

## 2. Core: bangun domain (opsional, ±10 menit)

Buka **Domain**. Tahap ini punya empat tugas: **1 · Pilih metode**, **2 · Kontak**, **3 · Bangun & tinjau**, **4 · Serah terima**.

- **Di antara permukaan kontak:** buat kelompok geologi dari kode litologi (misalnya SAP), simpan surface atas dan bawah dari kontaknya, lalu bangun solid di antara keduanya.
- **Cincin penampang hasil digitasi:** gambar cincin tertutup pada beberapa penampang paralel, lalu bangun loft.
- Setelah dibangun, periksa volume, topologi, dan cek terhadap collar. Isi nama peninjau dan alasan, lalu terima solid. Solid bisa diekspor ke DXF atau OBJ.
- **Lanjut di Assay →** membawa tabel master dan solid yang sudah ditinjau ke Assay.

Detail tiap langkah ada di [panduan Core Domain → Assay → Resource](https://geosuite.orebit.id/docs/#/ref/domain-workflow).

## 3. Assay: pahami kadarnya (3 menit)

[Buka Orebit Assay](https://geosuite.orebit.id/Assay.html). Contoh bawaan berisi interval 1 m dari 350 lubang dengan Ni, Co, Fe, MgO, SiO2, Al2O3, dan Cr2O3.

- **Statistik** menampilkan rata-rata, CV, dan persentil per unsur.
- **Top-Cut** menunjukkan ekor atas distribusi dan batas atas yang disarankan.
- **Statistik Domain** membandingkan populasi per domain. Perubahan metode berupa pratinjau. Isi alasan lalu klik **Terapkan populasi yang ditinjau** untuk memakainya.
- **Komposit** membuat komposit dengan panjang pilihan Anda. Bila datang dari Domain Core, komposit berhenti di batas keras domain.

## 4. Resource: estimasi dan laporan (4 menit)

[Buka Orebit Resource](https://geosuite.orebit.id/Resource.html), lalu klik **Mulai review**.

- **Setup:** pilih Ni, satuan persen, dan satu horizon, misalnya saprolit.
- **Variografi:** klik **Hitung & fit variogram**. Periksa titik eksperimen, jumlah pasangan, dan model. Arah 3D custom (azimuth dan dip) ada di parameter variogram.
- **Block Model:** periksa ukuran sel dan densitas, lalu klik **Bangkitkan Grid**. Bila solid domain dari Core ikut, blok dipotong oleh solid tersebut.
- **Estimasi:** klik **Jalankan Estimasi (IDW + OK + NN)**, lalu periksa **Cross-Val** dan **Swath**.
- **Grade-Tonnage** membandingkan cut-off. **Laporan Handoff** mencatat cut-off, metode, densitas, dan batasannya. Hasilnya screening, bukan Sumber Daya Mineral.

## 5. Data Anda sendiri

Di Core, buka **Impor** dan masukkan CSV collar, survey, assay, dan geologi. Nama kolom seperti `Au (g/t)` atau `Cu (%)` dikenali otomatis. Kode lab seperti `-0.005` (di bawah batas deteksi) dan `-999` (kosong) ditangani saat impor. Impor dan perhitungan berjalan di komputer Anda.

Simpan proyek dari menu profil (avatar di kanan atas) sebagai file `.orebit`. File ini bisa dibuka ulang di modul yang sama.

## Instalasi dan pemakaian offline

Versi web tidak perlu dipasang. Di Chrome atau Edge pilih **Install app**; di Safari macOS 14+ pilih **File → Add to Dock**. Buka Core, Assay, dan Resource sekali saat online sebelum dipakai offline. Google Drive, peta satelit, dan pemeriksaan update tetap memerlukan internet.

Pengguna Windows bisa mengunduh tiga executable dari [GitHub Releases](https://github.com/ghoziankarami/geosuite/releases/latest). Executable belum ditandatangani; cocokkan dengan daftar checksum di halaman rilis.

Penyimpanan browser terikat pada profil browser. Menghapusnya bisa menghilangkan pekerjaan tersimpan, jadi simpan file `.orebit` di luar browser. Untuk build dari source, ikuti [panduan instalasi repo](https://github.com/ghoziankarami/geosuite#run-from-source).

Di ponsel atau tablet, **Alur** membuka tahap utama dan **Lanjutan** membuka tools opsional.

## Selanjutnya

[Tutorial Thalanga](01-thalanga-vms.md) memakai dataset publik dari Queensland dan membahas setiap keputusan, dari kompilasi mentah sampai skrining grade-tonnage yang dibandingkan dengan produksi 1989–1998. [Manual](https://geosuite.orebit.id/docs/) menjelaskan setiap layar dan pengaturan. Dataset CSV laterit nikel sintetis tersedia di [repo dataset publik](https://github.com/ghoziankarami/orebit-datasets/tree/main/02-nikel-laterit).
