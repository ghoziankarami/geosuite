# Vignette 01 — Thalanga (VMS Zn-Pb-Cu-Ag-Au): dari data publik mentah ke skrining sumber daya yang bisa dipertanggungjawabkan

> **English:** [en/01-thalanga-vms.md](en/01-thalanga-vms.md)

| | |
|---|---|
| **Data** | *NEQ Deposit Atlas – Thalanga* (ds100103), Geological Survey of Queensland, **CC BY 4.0** — <https://geoscience.data.qld.gov.au/dataset/ds100103>. Ini juga dataset contoh bawaan Orebit Core, jadi Anda bisa mengikuti vignette ini tanpa mengunduh apa pun. |
| **Modul** | Core → Assay → Resource |
| **Waktu** | ±45 menit bila diikuti manual |
| **Hasil akhir** | Skrining *grade-tonnage* yang jujur, lengkap dengan daftar alasan mengapa hasil ini **belum** Sumber Daya Mineral |
| **Bisa diulang** | `node build/build.mjs && python3 docs/vignettes/tools/run_thalanga.py` — seluruh angka di halaman ini dibaca dari [`data/thalanga.json`](data/thalanga.json) yang ditulis skrip itu, dan `test_vignettes.py` menggagalkan build bila aplikasi mulai menghasilkan angka lain. |

Vignette ini sengaja tidak memakai data "bersih" buatan. Data kompilasi pemerintah seperti ini persis yang sering diterima geologis eksplorasi di dunia nyata: ratusan lubang dari banyak perusahaan dan banyak dekade, kode laboratorium yang berganti-ganti, lubang geokimia dangkal bercampur lubang intan dalam. Tujuannya bukan menghasilkan angka yang indah, tetapi menunjukkan **setiap keputusan** yang harus diambil geologis, **alasannya**, dan **apa yang terjadi bila keputusan itu dilewati**.

---

## 0. Konteks geologi dan patokan pembanding

Thalanga adalah endapan sulfida masif vulkanogenik (VMS) Zn-Pb-Cu-Ag-Au di Mount Windsor Subprovince, ±65 km barat daya Charters Towers, Queensland. Tambang bawah tanahnya berproduksi **1989–1998** dan menghasilkan **4,7 Mt @ 8,3 % Zn, 2,6 % Pb, 1,9 % Cu** ([mining-technology.com](https://www.mining-technology.com/projects/thalanga-zinc-project-queensland/)).

Angka produksi itulah patokan kita. Jangan pernah menilai sebuah estimasi hanya dari "apakah program selesai tanpa error". Tanyakan: *apakah hasilnya masuk akal dibanding sesuatu yang diketahui secara independen?* Di akhir (§12) kita membandingkan hasil skrining dengan patokan ini dan menjelaskan selisihnya.

Satu catatan jujur sejak awal: data ini **tidak memuat logging litologi untuk lubang-lubang bor intan di endapan utama**. Tanpa litologi tidak ada model geologi. Itu membatasi segalanya setelahnya, dan kita akan melihat akibatnya dengan jelas.

---

## 1. Memuat data (Core)

Buka **Orebit Core**. Dataset Thalanga termuat otomatis sebagai contoh.

![Dashboard Core dengan dataset Thalanga](img/thalanga-01-core-dashboard.png)

| Tabel | Baris |
|---|---:|
| Collar | 717 |
| Survey | 667 |
| Assay | 9.073 |
| Geology | 14.518 |

Sebelum melihat peta, lihat dulu **jenis lubangnya**:

| Tipe bor | Jumlah lubang |
|---|---:|
| BEDRK (geokimia batuan dasar, dangkal) | 520 |
| REVC (RC) | 55 |
| PERC (perkusi) | 45 |
| RAB | 39 |
| ACORE | 21 |
| TCH (paritan) | 19 |
| DD (bor intan) | 18 |

**Pelajaran pertama:** ini kompilasi regional, bukan basis data bor sebuah endapan. Tiga perempat lubangnya adalah lubang geokimia dangkal untuk mencari anomali, bukan untuk mengukur tonase. Kalau semua lubang ini dicampur ke dalam estimasi, ratusan sampel "latar belakang" dari puluhan kilometer jauhnya ikut mempengaruhi statistik dan variogram. Langkah pemotongan (§4) ada karena alasan ini.

---

## 2. Kode kadar laboratorium: angka negatif bukan angka

Data assay lama memakai angka negatif sebagai kode, dan artinya berbeda-beda antar laboratorium dan antar dekade. Core mendeteksinya saat impor dan menerapkan satu aturan yang terdokumentasi (`src/shared/io/grades.js`):

- **nilai negatif biasa** (−0,01; −5; −0,0001) → *di bawah batas deteksi*, dipakai **setengah** batas deteksi;
- **kode "semua sembilan"** (−999, −9999 …) **atau** nilai negatif yang besarnya melampaui nilai positif maksimum kolom itu → **data hilang** (kosong), karena mustahil ada batas deteksi yang lebih tinggi daripada kadar tertinggi yang pernah diukur;
- **`>X`** (di atas batas atas) → X, dan ditandai.

Hasilnya pada Thalanga: **2.428** nilai di bawah batas deteksi dan **41** kode data hilang.

| Kolom | < batas deteksi | Kode hilang | Nilai positif maks. |
|---|---:|---:|---:|
| au_gpt | 1.223 | 0 | 1.380 |
| ag_gpt | 578 | 19 | 9.560 |
| s_pct | 485 | 7 | 5 |
| cu_ppm | 68 | 0 | 114.200 |
| pb_ppm | 68 | 15 | 248.000 |
| zn_ppm | 6 | 0 | 406.000 |

Mengapa ini penting: kolom Pb berisi kode **−995.000** dan Ag **−9.910.000**. Program yang memperlakukan setiap angka negatif sebagai "setengah batas deteksi" akan memberi sampel-sampel itu kadar Pb 49 % dan Ag 4.955 g/t, yaitu 15 bonanza palsu. Program yang memperlakukannya sebagai nol, atau membuangnya diam-diam, menurunkan rata-rata tanpa jejak. Aturan batas maksimum di atas membedakan kedua kasus tanpa perlu tebakan per laboratorium, dan **Au 1.223 nilai deteksi-batas dari beberapa era** (−0,01; −0,05; −0,0001) tetap diperlakukan dengan benar sebagai nilai rendah yang nyata.

> Periksa sendiri: di tab **Validation** Core, baris *Below-detection (negative) grade values* menunjukkan **0** setelah impor. Itu bukan berarti datanya bersih. Artinya semua kode sudah diterjemahkan dan dicatat.

---

## 3. Validasi: temukan, putuskan, catat

Tab **Validation** Core menjalankan 16 pemeriksaan.

![Validasi Core — status FIX REQUIRED](img/thalanga-02-core-validation.png)

| Pemeriksaan | Sebelum | Sesudah perbaikan |
|---|---|---|
| Collar tanpa survey (dianggap vertikal) | 259 lubang ⚠ | 259 ⚠ |
| Collar tanpa assay | 16 lubang ⚠ | 16 ⚠ |
| Collar tanpa geologi | 381 lubang ⚠ | 381 ⚠ |
| **hole_id collar ganda** | **6 ✗** | 6 ✗ |
| Celah (gap) interval assay | 208 ⚠ | 206 ⚠ |
| **Tumpang tindih (overlap) interval assay** | **115 ✗** | 113 ✗ |
| Keputusan keterkaitan | **FIX REQUIRED** | **FIX REQUIRED** |

Apa isi temuan itu (diperiksa baris demi baris):

- **6 collar ganda.** LVRC001–LVRC005 tercatat dua kali, di bawah dua program berbeda (RGMWP dan TCLV), dengan selisih koordinat 1–5 cm. Ini lubang yang sama, dikompilasi dua kali. BEA317 tercatat sebagai ACORE dan BEDRK.
- **115 overlap.** Umumnya sampel ulang atau komposit lapangan yang ikut dikompilasi. Contoh: TCRC11 berisi interval 4–5 m *dan* komposit 4–8 m.
- **259 lubang tanpa survey** akan dianggap vertikal. Semuanya lubang dangkal (236 BEDRK, 20 perkusi, 3 RC; median kedalaman 36 m, terdalam 150 m), jadi efeknya kecil. Pada lubang dalam, anggapan ini fatal (§4).
- **381 lubang tanpa geologi, termasuk semua lubang bor intan di endapan.**

### Dua perbaikan yang dilakukan, dan mengapa hanya dua

1. **Dua spot sample di TH37** (190,0–190,2 m dan 490,0–490,2 m, ID sampel `TH37190`, `TH37490`) berada sepenuhnya *di dalam* interval yang lebih panjang di lubang yang sama. Ini sampel cek yang ikut terkompilasi. Keduanya dihapus, karena kalau dibiarkan interval yang sama terhitung dua kali.
2. **Au 1.380 g/t di TH35 100,0–100,2 m.** Nilai tertinggi berikutnya di seluruh dataset hanya 1,69 g/t, sekitar 800× lebih kecil. Pada interval yang sama Ag hanya 1 g/t dan Zn 1.210 ppm. Bonanza emas tanpa perak dan tanpa logam dasar di sistem VMS secara geologi tidak masuk akal; yang paling mungkin adalah salah satuan atau salah koma. **Nilai itu dikosongkan, bukan "dikoreksi" menjadi 1,38.** Kita tidak menebak isi sertifikat laboratorium. Kosongkan, catat, dan minta sertifikat aslinya.

Keduanya dilakukan di editor data Core dan tercatat otomatis di **CHANGE_LOG**:

```
assay: 1 rows edited, 0 added, 2 deleted
```

CHANGE_LOG ikut terekspor. Siapa pun yang menerima file Anda bisa melihat persis apa yang diubah dan kapan.

### Mengapa status tetap "FIX REQUIRED", dan itu benar

Sisa masalah (collar ganda LVRC/BEA, ratusan overlap TCRC dan sejenisnya) semuanya berada di **lubang regional di luar area endapan**. Geologis senior tidak "membersihkan" data yang tidak akan dipakai hanya supaya lampu indikator hijau. Data itu **dikeluarkan secara eksplisit** lewat batas area (§4), dan alasannya ditulis. Status merah di sini adalah catatan yang jujur, bukan kegagalan.

---

## 4. Desurvey dan pemotongan ke area endapan

### Desurvey

Tab **Desurvey** mendeteksi konvensi dip dari data: `positive_down`, yaitu dip positif berarti ke bawah. Hasilnya: 711 lubang ter-desurvey, 0 survey rusak.

![Jejak lubang ter-desurvey](img/thalanga-03-core-desurvey.png)

Lubang-lubang intan di Thalanga **melandai sangat kuat** ke arah dasarnya:

| Lubang | Kedalaman akhir | Elevasi dasar lubang (z) |
|---|---:|---:|
| TH1 | 257 m | 140,9 m |
| TH5 | 395,9 m | 117,2 m |
| TH40 | 593,3 m | −103,1 m |

TH5 sepanjang hampir 400 m hanya turun sekitar 180 m dan berakhir hampir horizontal. Seandainya survey diabaikan dan lubang dianggap vertikal, setiap sampel di bagian bawah TH5 akan diletakkan ratusan meter terlalu dalam dan puluhan meter dari posisi sebenarnya. Estimasi blok yang dibangun di atas posisi itu salah secara spasial, tanpa ada satu pun pesan error.

### Pemotongan (crop) ke area endapan

Karena tidak ada logging litologi di lubang endapan, kita tidak bisa membangun *wireframe* geologi. Batas yang jujur adalah **kotak area endapan** yang dibatasi secara eksplisit di sekitar lubang-lubang seri TH (MGA zona 55):

```
X 370.200 – 372.900 m   Y 7.750.000 – 7.750.800 m
```

File: [`data/thalanga-deposit-area.geojson`](data/thalanga-deposit-area.geojson). Muat di tab **Crop to Constraint**.

![Crop ke area endapan](img/thalanga-04-core-crop.png)

| | |
|---|---:|
| Interval di dalam | **667** dari 9.071 |
| Interval dibuang | 8.404 |
| Lubang di dalam | **13** dari 695 |

Perhatikan: peta menunjukkan **12 collar** di dalam kotak, tetapi **13 lubang** menyumbang interval. Core memotong berdasarkan **posisi titik tengah interval yang sudah ter-desurvey**, bukan posisi collar. Satu lubang di-collar di luar kotak tetapi menembus ke dalamnya. Pemotongan berbasis collar akan kehilangan interval itu.

Lubang yang tersisa: TE-1, TE-2, TH1, TH2, TH3, TH4, TH5, TH6, TH31, TH35, TH37, TH39, TH40. Ke-13 lubang ini (11 bor intan, 2 perkusi) semuanya punya survey, tidak ada yang termasuk collar ganda, dan satu-satunya overlap di dalamnya adalah dua spot sample TH37 yang sudah dihapus di §3. Ekspor **Cropped master CSV (desurveyed)** untuk langkah berikutnya.

---

## 5. Kenali populasinya sebelum memutuskan apa pun

Sebelum masuk ke Assay, statistik 667 sampel ini dihitung **terpisah dari aplikasi** (Python murni, langsung dari CSV hasil ekspor):

| Zn (%) | |
|---|---:|
| Rata-rata | 2,245 |
| Median | 0,2 |
| Koefisien variasi (CV) | **2,66** |
| P95 / P99 / maks. | 15,1 / 31,2 / 40,6 |
| Panjang sampel median / modus | 0,7 m / 1,0 m |

Rata-rata sebelas kali median, dengan CV 2,66. Distribusi seperti ini bisa berarti dua hal yang penanganannya sangat berbeda:

- **satu populasi dengan beberapa pencilan** → diperlakukan dengan *top-cut*;
- **campuran dua populasi** (bijih sulfida masif dan batuan samping) → diperlakukan dengan **domain**.

Uji sederhana yang membedakannya adalah melihat di mana logamnya berada:

| Sampel dengan Zn ≥ | Bagian logam Zn total |
|---|---:|
| 0,5 % | 95,7 % |
| 1 % | **91,7 %** |
| 2 % | 87,0 % |
| 5 % | 74,6 % |

Lalu pisahkan pada 1 % Zn:

| | n | Rata-rata Zn | CV |
|---|---:|---:|---:|
| ≥ 1 % (di dalam *shell*) | 170 | 8,26 % | **1,15** |
| < 1 % (di luar) | 497 | 0,187 % | 1,26 |

CV turun dari 2,66 menjadi 1,15 begitu kedua populasi dipisah. **Variabilitas tinggi itu berasal dari campuran populasi, bukan dari pencilan.** Kesimpulan ini menentukan dua keputusan berikutnya: *jangan* memangkas kadar tinggi, dan *pisahkan* domain.

---

## 6. Assay: pilih komoditas, uji top-cut, bangun domain

Unggah master CSV hasil crop ke **Orebit Assay**. Assay mengenali satuan dari nama kolom dan mengonversi `zn_ppm`, `pb_ppm`, `cu_ppm` menjadi persen (÷ 10.000). Konversi itu ditampilkan, tidak dilakukan diam-diam.

### Pilih komoditas utama

Secara bawaan Assay mengambil kolom kadar pertama, yaitu **cu_pct**. Untuk endapan seng, itu keliru. Pilih **zn_pct** di pemilih **Commodity**. Pilihan ini berlaku untuk validasi, domain, QAQC, laporan, dan PDF.

![Statistik Zn](img/thalanga-05-assay-stats.png)

### Top-cut: diuji, lalu sengaja tidak dipakai

Tab **Top-Cut** mencari titik *disintegrasi*, yaitu tempat ekor distribusi mulai terputus-putus. Pada Zn titik itu ada di **27,5 %** (persentil 98,1).

![Diagnostik top-cut](img/thalanga-06-assay-topcut.png)

**Keputusan: tidak ada top-cut untuk Zn.** Alasannya:

1. §5 menunjukkan variabilitas berasal dari campuran populasi. Di dalam domain mineralisasi CV hanya 1,15, jauh di bawah ambang yang biasanya membuat geologis mempertimbangkan pemangkasan (sekitar 1,5–2).
2. Zn 27–40 % adalah sulfida masif kaya sfalerit, **populasi nyata** yang memang ditambang di sini. Memangkasnya ke 27,5 % berarti menghapus logam nyata dari bijih terbaik.
3. Top-cut dipakai untuk membatasi pengaruh *sedikit* sampel ekstrem terhadap *banyak* blok. Masalah itu ditangani lebih baik oleh strategi pencarian (§8).

Keputusan tidak memangkas sama pentingnya dengan keputusan memangkas, dan **harus ditulis** di laporan beserta alasannya.

### Domain: *grade shell* 1 % Zn, karena tidak ada litologi

Tab **Domain** → metode **Grade shell (cut-off)**, cut-off **1** (% Zn).

![Domain grade shell 1 % Zn](img/thalanga-07-assay-domain.png)

| Domain | Sampel |
|---|---:|
| M1-Mineralised (Zn ≥ 1 %) | 170 |
| M0-Background (Zn < 1 % atau tidak dianalisis) | 497 |

Mengapa 1 %: angka itu menangkap 91,7 % logam (§5), memisahkan dua populasi dengan CV yang wajar, dan cukup rendah sehingga tidak "memotong" bijih. Cut-off *domain* bukan cut-off *ekonomi*. Ia memisahkan populasi, bukan menentukan apa yang layak ditambang.

**Keterbatasan yang harus diakui:** *grade shell* bukan domain geologi. Ia dibentuk oleh kadar itu sendiri, sehingga cenderung terlalu optimistis di tepi (sampel rendah di antara sampel tinggi ikut dibuang) dan tidak tahu apa-apa tentang kontak litologi atau struktur. Dengan logging litologi, domain seharusnya dibangun dari kontak sulfida masif / stringer / batuan samping. Karena datanya tidak ada, kita memakai *grade shell* dan menulis keterbatasan ini.

### Kompositing 1 m

Tab **Composite**, panjang **1 m** (modus panjang sampel).

![Kompositing 1 m](img/thalanga-08-assay-composite.png)

| | |
|---|---:|
| Komposit | **507** (M1: 98, M0: 409) |
| Sampel nyata yang terbuang (ekor < panjang minimum) | 11,38 m |
| Panjang lubang tanpa sampel sama sekali | 1.112 m |
| Overlap | 0 |
| Komposit yang < 50 % terisi sampel nyata | 77 |

Core memperlakukan interval tanpa sampel sebagai **tidak diketahui**, bukan nol. Pada data kompilasi, interval yang tidak dianalisis biasanya *dianggap* barren oleh pengebor, tetapi anggapan itu harus diputuskan geologis, bukan program. Setiap komposit membawa kolom `coverage`. Peringatan kuning di layar menandai **77 komposit** yang kurang dari separuhnya berisi sampel nyata. Periksa itu sebelum estimasi.

Ekspor **Export composite CSV** (`exportMasterForEstimation`). File itu sudah membawa koordinat, domain, dan kadar dalam persen.

---

## 7. Resource: setup, variogram, model blok

Unggah komposit ke **Orebit Resource**. Di **Setup** pilih elemen **zn_pct** dan domain **M1-Mineralised**: 98 komposit.

![Setup Resource](img/thalanga-09-resource-setup.png)

### Variogram

![Variogram Zn di domain M1](img/thalanga-10-resource-variogram.png)

Model yang dicocokkan otomatis: **eksponensial**, nugget **67,2**, sill **112,0** (%²), range **326 m**. Artinya nugget sekitar **60 % dari sill**.

Cara membacanya: 98 komposit dari segelintir lubang berarti sebagian besar pasangan di variogram eksperimental adalah pasangan *sepanjang lubang*, bukan *antar lubang*. Nugget 60 % mengatakan bahwa pada jarak antar lubang sebagian besar variabilitas kadar Zn **tidak bisa diprediksi** dari tetangga, sesuatu yang wajar untuk lensa sulfida masif yang berselingan dengan batuan samping dalam jarak meter. Range 326 m didukung sangat sedikit pasangan. Anggap itu indikatif, bukan terukur.

### Ukuran blok

Aplikasi menyarankan 15 × 15 × 8 m. Tab Estimation melaporkan **jarak antar lubang terdekat: median 91 m, P90 96 m**. Blok yang jauh lebih kecil dari seperempat jarak bor hanya memberi ilusi resolusi: kriging pada blok 15 m di antara lubang yang berjarak 90 m menghasilkan ratusan blok dengan kadar hampir sama yang tampak seperti detail padahal bukan.

Dipakai **25 × 25 × 10 m** (sekitar ¼ jarak lubang; 10 m = tinggi *bench*/level tipikal). Hasilnya **20.967 blok** (84 × 20 × 29). Densitas dibiarkan pada nilai bawaan **2,8 t/m³**, dan aplikasi dengan tepat menandainya sebagai **ASUMSI** (§11).

---

## 8. Estimasi: pelajaran terpenting di vignette ini

### Percobaan A — parameter bawaan, tanpa batas

Jalankan estimasi dengan radius pencarian yang disarankan otomatis (1,5 × range variogram, dilebarkan untuk data jarang): **489 × 489 × 135 m**, minimal 2 komposit.

![Estimasi tanpa batas](img/thalanga-11a-resource-estimate-unconstrained.png)

| | |
|---|---:|
| Blok terestimasi | **15.744** dari 20.967 |
| Tonase (2,8 t/m³) | **276 Mt** |
| Logam Zn | **17,0 Mt** |
| Kadar OK terendah | 1,05 % |

Ini **59 kali** produksi historis. Tidak ada error, tidak ada peringatan merah, dan angkanya salah total. Penyebabnya:

- estimasi memakai komposit domain M1 saja (semua ≥ 1 % Zn), lalu **menyebarkan kadar itu ke setiap blok dalam radius 489 m**, termasuk ratusan meter batuan samping. Kadar blok terendah 1,05 % karena tidak ada satu pun sampel rendah yang ikut;
- elipsoid pencarian bulat (tanpa arah) pada lensa yang memanjang.

Model blok tidak punya batas domain 3D di sini, karena tanpa litologi tidak ada wireframe. Maka **strategi pencarian yang harus menahan ekstrapolasi**. Parameter bawaan perangkat lunak bukan keputusan geologi.

### Percobaan B — pencarian yang dibatasi geologi

Arah jurus dari sebaran komposit (PCA): **azimut 98°**, kira-kira timur–barat, sesuai sebaran lubang seri TH. Parameter:

| | | Alasan |
|---|---|---|
| r Major | 100 m | ± setengah jarak antar lubang sepanjang jurus |
| r Semi | 50 m | geometri melintang jurus tidak terselesaikan (lihat bawah) |
| r Minor | 25 m | ketebalan lensa jauh di bawah 100 m |
| Azimut / dip | 98° / 0° | jurus dari data; kemiringan tidak bisa ditentukan dengan andal |
| Min / maks komposit | 4 / 12 | tidak ada blok yang diisi satu intersep saja |

![Estimasi dengan pencarian terbatas](img/thalanga-11-resource-estimate.png)

| | OK | IDW | NN |
|---|---:|---:|---:|
| Blok | 717 | 717 | 717 |
| Kadar rata-rata Zn | **7,63 %** | 7,87 % | 7,12 % |
| Tonase | **12,547 Mt** | | |
| Logam Zn | **957,6 kt** | | |

**Kemiringan (dip) lensa tidak terselesaikan.** Penampang melintang antar lubang memberi kemiringan 2°, 12°, dan 41°, tidak konsisten. Dengan 13 lubang tanpa litologi, orientasi lensa tidak bisa ditentukan. Karena itu elipsoid dibuat pipih dan kecil ke arah melintang. Ini pilihan konservatif, dan ini pula keterbatasan terbesar hasil ini.

**Cek rata-rata global:** rata-rata NN (7,12 %) adalah pendekatan rata-rata yang sudah *declustered*. OK lebih tinggi **7 %** darinya. Praktik umum menerima selisih sekitar ±5 %; 7 % adalah **tanda kuning**. Estimasi ini cenderung sedikit optimistis, kemungkinan karena blok-blok jauh diisi komposit berkadar tinggi yang berkelompok.

---

## 9. Validasi silang

Tab **Cross-Val** (*leave-one-out*, n = 92 komposit):

![Validasi silang](img/thalanga-12-resource-crossval.png)

| | OK | IDW | NN |
|---|---:|---:|---:|
| Slope regresi (prediksi terhadap aktual) | **0,68** | 0,77 | 0,82 |
| r² | 0,71 | 0,75 | 0,71 |
| Bias rata-rata (prediksi − aktual) | **+0,04** | +0,24 | +0,19 |
| RMSE | 4,90 | 4,62 | 5,07 |

Cara membaca: OK **tidak bias secara global** (+0,04 % Zn dari rata-rata 8,43 %), tetapi **bias bersyarat**. Slope 0,68 berarti kadar tinggi diremehkan dan kadar rendah dilebih-lebihkan. Ini perataan (*smoothing*) yang diharapkan dengan nugget 60 %. Akibatnya kurva grade-tonnage **pada cut-off tinggi** harus dibaca hati-hati: tonase di atas cut-off tinggi cenderung terlalu besar dengan kadar terlalu rendah. Slope ≥ 0,8–0,9 biasanya dicari untuk estimasi yang dipakai membuat keputusan per blok.

---

## 10. Skrining keyakinan dan grade-tonnage

### Skrining keyakinan

Tab **Preliminary Confidence** membagi 717 blok berdasarkan jarak ke data dan jumlah lubang:

| Tingkat | Blok |
|---|---:|
| Keyakinan tinggi | 106 |
| Keyakinan sedang | 262 |
| Keyakinan rendah | 349 |

![Skrining keyakinan](img/thalanga-12b-resource-confidence.png)

Ini **skrining komputasi**, bukan klasifikasi *Measured / Indicated / Inferred*. KCMI 2017 dan JORC 2012 tidak menetapkan ambang numerik. Klasifikasi adalah keputusan tertulis seorang *Competent Person* yang menimbang geologi, QAQC, densitas, dan kontinuitas. Karena itulah GeoSuite sengaja tidak memakai istilah itu.

Satu hal yang layak dicatat: kadar rata-rata blok berkeyakinan tinggi + sedang (**7,08 %**) **lebih rendah** daripada semua blok (7,63 %). Artinya kadar tertinggi berada di blok yang paling jauh dari data. Itu pola klasik ekstrapolasi, dan alasan lain untuk curiga pada angka di cut-off tinggi.

### Grade-tonnage, diperiksa independen

Kurva di tab **Grade-Tonnage** dihitung oleh aplikasi. Tabel di bawah dihitung **ulang secara independen** dari model blok yang diekspor (`exportBlockCSV`), dengan Python biasa, lalu dibandingkan dengan kurva aplikasi. `test_vignettes.py` menggagalkan build bila keduanya berselisih.

| Cut-off Zn | Tonase (Mt) | Kadar Zn | Logam Zn (kt) | Hanya tinggi + sedang: Mt @ % |
|---|---:|---:|---:|---|
| 0 / 1 % | 12,547 | 7,63 % | 957,6 | 6,440 @ 7,08 |
| 2 % | 11,008 | 8,45 % | 930,2 | 5,775 @ 7,69 |
| 3 % | 7,455 | 11,22 % | 836,8 | 3,780 @ 10,38 |
| 5 % | 5,145 | 14,67 % | 754,8 | 2,678 @ 13,24 |
| 8 % | 4,253 | 16,30 % | 693,0 | 2,205 @ 14,62 |

![Kurva grade-tonnage (hanya tinggi + sedang)](img/thalanga-13-resource-grade-tonnage.png)

---

## 11. Densitas: satu angka yang mengubah tonase ±30 %

Tab **KCMI** menampilkan dasar densitas sebagai:

> *ASSUMED uniform default — not measured. Enter the deposit's measured SG before reporting tonnage.*

![Tab KCMI dengan densitas berstatus ASUMSI](img/thalanga-14-resource-kcmi.png)

Bijih sulfida masif dengan sfalerit, galena, dan pirit umumnya memiliki densitas **3,2–4,0 t/m³**, bukan 2,8. Karena tonase berbanding lurus dengan densitas, memakai 2,8 bisa **meremehkan tonase bijih sulfida masif hingga ±30 %**, sementara pada zona stringer / disseminasi 2,8 mungkin wajar. Densitas harus diukur, per domain atau diregresikan terhadap kadar Fe+S+Zn+Pb. Tanpa itu tonase belum layak dilaporkan.

---

## 12. Uji kewajaran terhadap produksi historis

| | Tonase | Zn |
|---|---:|---:|
| Produksi 1989–1998 | 4,7 Mt | 8,3 % |
| Skrining ini, semua blok, cut-off 1 % | 12,5 Mt | 7,63 % |
| Skrining ini, cut-off 5 % | 5,1 Mt | 14,67 % |
| Skrining ini, tinggi + sedang, cut-off 1 % | 6,4 Mt | 7,08 % |

**Kadar** berada dalam 10 % dari kadar yang ditambang. Itu wajar, karena kadar komposit di dalam *shell* diukur langsung dari bor. **Tonase** 2,7 kali produksi. Penjelasan yang masuk akal, dari yang paling berpengaruh:

1. **Produksi bukan sumber daya.** Tambang menambang sebagian endapan pada cut-off ekonomi dengan dilusi, lalu tutup karena alasan ekonomi. Endapan ini kemudian dikembangkan kembali, yang berarti mineralisasi tersisa setelah 1998.
2. **Batas yang longgar.** Kotak area dan *grade shell* 1 % ikut memasukkan zona stringer / disseminasi di sekitar lensa sulfida masif. Tanpa wireframe litologi, volume itu tidak bisa dipisahkan.
3. **Orientasi yang tidak terselesaikan.** Elipsoid horizontal pada lensa yang kemiringannya tidak diketahui menyebarkan kadar melintasi batas lensa.
4. **Densitas** bekerja ke *arah sebaliknya*: densitas terukur yang lebih tinggi akan *menambah* tonase. Jadi selisih tonase bukan disebabkan densitas.

Kesimpulan yang jujur: dari 13 lubang tanpa litologi, GeoSuite menghasilkan **orde besaran dan kadar yang masuk akal**, tetapi **volume tidak bisa ditentukan dengan kepastian yang layak dilaporkan**. Inilah fungsi skrining: memberi tahu *apa yang harus dikerjakan berikutnya*, bukan menggantikannya.

---

## 13. Ini bukan Sumber Daya Mineral. Yang dibutuhkan untuk menjadi Sumber Daya Mineral:

- [ ] **Logging litologi dan model geologi 3D** lensa sulfida masif / stringer / batuan samping, sebagai pengganti *grade shell*;
- [ ] **Orientasi lensa** yang terselesaikan (penampang terinterpretasi, data struktur, atau pengeboran tambahan);
- [ ] **Densitas terukur** per domain;
- [ ] **QAQC**: standar (CRM), blanko, dan duplikat untuk kampanye yang dipakai, sertifikat laboratorium, termasuk resolusi **Au 1.380 g/t TH35**;
- [ ] **Verifikasi survey collar dan downhole** (sistem koordinat, metode survey);
- [ ] Penanganan **interval tanpa sampel** yang diputuskan geologis;
- [ ] Validasi *swath plot*, rekonsiliasi terhadap produksi historis dan terhadap tambang (void) yang sudah ada;
- [ ] Klasifikasi dan laporan oleh **Competent Person** sesuai KCMI 2017 / JORC 2012.

---

## Coba sendiri

1. Ubah cut-off domain ke **0,5 %** dan **2 %**. Perhatikan berapa logam yang masuk dan keluar dari domain, dan bagaimana CV di dalam domain berubah.
2. Masukkan densitas **3,6 t/m³** di tab Block Model, jalankan ulang, lalu bandingkan tonase.
3. Jalankan ulang Percobaan B dengan **minimal 2 komposit** dan **octant search** aktif. Blok mana yang berubah paling banyak?
4. Naikkan r Semi ke 100 m, lalu lihat hasil validasi silang dan rasio OK/NN.

## Mengulang vignette ini

```bash
node build/build.mjs                                   # build Core/Assay/Resource ke dist/
python3 docs/vignettes/tools/run_thalanga.py           # ±90 detik; tulis data/thalanga.json + img/
python3 docs/vignettes/tools/run_thalanga.py --no-shots  # tanpa tangkapan layar
```

Skrip menggerakkan build aplikasi yang sama dengan yang dipakai pengguna, di Chromium, langkah demi langkah seperti di atas. Angka kunci dihitung ulang dari file ekspor secara independen.

## Atribusi

Data: © State of Queensland (Geological Survey of Queensland), *NEQ Deposit Atlas – Thalanga* (ds100103), dilisensikan di bawah [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Data dimuat sebagaimana dipublikasikan. Satu-satunya perubahan adalah dua penghapusan dan satu pengosongan nilai yang dijelaskan di §3, dan ketiganya tercatat di CHANGE_LOG. Batas area (`thalanga-deposit-area.geojson`) adalah buatan vignette ini. Angka produksi historis: mining-technology.com, *Thalanga Zinc Project, Queensland*.
