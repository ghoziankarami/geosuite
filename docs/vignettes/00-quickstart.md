# Mulai cepat: GeoSuite dalam 10 menit

**Periksa build terlebih dahulu.** Panduan ini ditujukan untuk build dengan sampel **laterit nikel sintetis, 350 lubang bor**. Source publik, rilis Windows, dan modul web dapat berasal dari revisi berbeda. Build lama memakai sampel Thalanga; instalasi saja tidak mengganti sampelnya. Periksa nama sampel dan jumlah lubang sebelum mengikuti angka di bawah. Jika build Anda menampilkan Thalanga, gunakan [tutorial Thalanga](01-thalanga-vms.md) yang mengimpor data publiknya sendiri, atau tunggu publikasi build produk yang sesuai.

Setiap modul terbuka dengan dataset contoh yang sudah dimuat: 350 lubang bor pada endapan laterit nikel (sintetis, CC BY 4.0, kredit Orebit.id). Anda tidak perlu akun atau file sendiri. Ikuti empat langkah di bawah dan Anda sudah melihat seluruh alur kerja, dari data bor mentah sampai kurva grade-tonnage.

## 1. Core: periksa data bor (3 menit)

[Buka Orebit Core](https://geosuite.orebit.id/try/Core.html). Gunakan **Mulai review** untuk alur utama. **Advanced tools** di sidebar membuka tabel dan penampang secara langsung.

- **Dashboard** menampilkan 350 lubang bor, 8.896 interval assay, dan 8,8 km pengeboran, dengan overburden, limonit, saprolit, dan batuan dasar tercatat; 10 lubang berhenti sebelum batuan dasar.
- **Validasi** memeriksa setiap lubang: survey yang hilang, interval tumpang tindih atau berlubang, lubang tanpa log geologi, dan mendaftar setiap temuan beserta alasannya.
- **Section** menggambar lubang bor pada penampang dengan kadar dan litologi.
- **Desurvey** mengubah collar dan survey menjadi lintasan lubang 3D.

## 2. Assay: pahami kadarnya (3 menit)

[Buka Orebit Assay](https://geosuite.orebit.id/try/Assay.html). Modul ini terbuka dengan interval nominal 1 m dari seluruh 350 lubang: Ni, Co, Fe, MgO, SiO2, Al2O3, dan Cr2O3, dibagi menjadi domain saprolit dan limonit.

- **Stats** memberi rata-rata, CV, dan persentil per unsur dan per domain.
- **Top-Cut** menunjukkan di mana ekor atas distribusi mulai pecah dan menyarankan batas atasnya.
- **Domain** membandingkan domain saprolit dan limonit serta membangun domain grade shell dari cut-off.

## 3. Resource: estimasi dan laporan (4 menit)

[Buka Orebit Resource](https://geosuite.orebit.id/try/Resource.html).

- Di **Dashboard**, klik **Mulai review**. Pada Setup pilih Ni, satuan persen dan satu horizon seperti saprolit; estimasi limonit terpisah jika sesuai interpretasi.
- **Variografi:** klik **Hitung & fit variogram**, lalu periksa titik eksperimen, jumlah pasangan dan model. Parameter custom serta pemeriksaan arah/downhole tersedia di bawah.
- **Block Model:** periksa ukuran sel, densitas dan envelope sebelum membuat grid. Lalu estimasi dan periksa cross-validation serta swath.
- **Grade-Tonnage** membandingkan cutoff. **Laporan** mencatat cutoff pilihan Anda atau tanpa cutoff, metode dan batasannya. Hasil screening bukan resource tersertifikasi.
- **Advanced tools** membuka tampilan opsional langsung. Pola aksi di atas dan sidebar yang sama berlaku pada Core dan Assay.

## 4. Data Anda sendiri

Di Core, buka **Import** dan masukkan file CSV collar, survey, assay, dan geologi Anda. Nama kolom seperti `Au (g/t)` atau `Cu (%)` dikenali otomatis, dan kode lab seperti `-0.005` (di bawah batas deteksi) atau `-999` (kosong) langsung ditangani. Impor CSV dan perhitungan berjalan lokal. Google Drive, peta satelit, dan pemeriksaan update opsional memerlukan internet.

Ekspor data master yang sudah divalidasi dari Core lalu muat di tab **Upload** pada Assay, kemudian teruskan ekspor Assay ke Resource dengan cara yang sama.

## Selanjutnya

[Tutorial Thalanga lengkap](01-thalanga-vms.md) memakai dataset publik (Queensland, dimuat dari file data tutorial itu sendiri) dan mengikutinya melalui setiap keputusan, dari kompilasi pemerintah mentah sampai skrining grade-tonnage yang dibandingkan dengan produksi 1989–1998. [Manual](https://geosuite.orebit.id/docs/) menjelaskan setiap layar dan pengaturan.

## Instalasi, pemakaian offline, dan cadangan

Versi web tidak memerlukan instalasi. Pada Chrome atau Edge, pilih **Install app**; pada Safari di macOS 14+, pilih **File → Add to Dock**. Buka **Core, Assay, dan Resource** sekali saat online sebelum pemakaian offline. Google Drive, peta satelit, dan pemeriksaan update tetap memerlukan koneksi.

Pengguna Windows juga bisa mengunduh tiga executable terpisah melalui [GitHub Releases](https://github.com/ghoziankarami/geosuite/releases/latest). Executable belum ditandatangani; bandingkan berkas dengan daftar checksum rilis.

Ekspor proyek sebagai cadangan. Penyimpanan browser mengikuti profil browser dan origin situs; menghapusnya dapat menghilangkan pekerjaan tersimpan. Simpan file ekspor di luar browser. Untuk build dari source, ikuti [panduan instalasi repo](https://github.com/ghoziankarami/geosuite#build-from-source).

Pola bor mengikuti prospek berarah jurus dengan batas tidak beraturan dan infill terpilih. Core menyimpan semua horizon mentah; contoh awal Assay/Resource memilih LIM/SAP. Density terukur tetap dibawa saat handoff. Untuk latihan validasi, gunakan [kasus survey hilang dan assay overlap](https://github.com/ghoziankarami/orebit-datasets/tree/main/exercises); periksa dan perbaiki sebelum export.
