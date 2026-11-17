# Run GeoSuite on your computer

[Orebit](https://orebit.id/) · [GeoSuite](https://geosuite.orebit.id/) ·
[Training datasets](https://github.com/ghoziankarami/orebit-datasets)

| Choose this route | What you need | Start here |
| --- | --- | --- |
| Web or installed web app | A current browser; internet for initial loading | [Open Core](https://geosuite.orebit.id/Core.html) |
| Windows executable | Windows 10/11; no Node or Python | [Public releases](https://github.com/ghoziankarami/geosuite/releases/latest) |
| macOS desktop | No Node or Python; unsigned app | [DMG and checksums](https://github.com/ghoziankarami/geosuite/releases/latest) |
| Local source build | Node.js 18+ and Python 3.9+; Windows, macOS or Linux | Commands below |

An executable is one distribution of GeoSuite. The GPL-3.0 source is also
available here: you can inspect, modify, build and redistribute it under the
licence. A local web build does not require the maintainer's private repository,
an account, a licence key, or a VPS.

## Windows executables

Since v3.2.4, download **one** `Orebit-GeoSuite.exe` and `SHA256SUMS.txt` from the [latest release](https://github.com/ghoziankarami/geosuite/releases/latest). Core, Assay and Resource share one window. Node and Python are not required.

```powershell
Get-FileHash .\Orebit-GeoSuite.exe -Algorithm SHA256
```

Compare the hash with the manifest, then run the EXE. It is unsigned; Windows SmartScreen may show **Windows protected your PC**. Use **More info → Run anyway** only for the verified official download. The dashboard shows the version and the valid built-in sample.

To update, download the new EXE and verify its checksum. Keep exported `.orebit` project backups. **Code → Download ZIP** contains source, not the executable.

## macOS desktop

Download `Orebit-GeoSuite-macos.dmg` and `SHA256SUMS.txt` from the same release:

```bash
shasum -a 256 Orebit-GeoSuite-macos.dmg
```

Compare the hash, open the DMG and drag GeoSuite to Applications. The app is unsigned and not notarised: on first launch use **right-click → Open**. macOS may ask for local-network access because the app serves itself on `127.0.0.1`. Core, Assay and Resource share one window. Node and Python are not required. Keep project backups when updating.

## Build and run locally / Jalankan dari kode sumber

Check `node --version` and `python3 --version` (Windows: `py -3 --version`).
Clone the repository, or download **Code → Download ZIP** on GitHub and extract it.
Open a terminal in the folder containing `package.json`.

```bash
git clone https://github.com/ghoziankarami/geosuite.git
cd geosuite
npm run build
python3 -m http.server 8767 --bind 127.0.0.1 -d dist
```

Windows PowerShell uses the same build command, then:

```powershell
py -3 -m http.server 8767 --bind 127.0.0.1 -d dist
```

Open **http://127.0.0.1:8767/Core.html**. Expect the Core dashboard, module/version
and sample data. Use Import for your own CSVs, then follow the tutorial chooser
below. Assay and Resource are at
`/Assay.html` and `/Resource.html` on that same address. Keep the terminal open;
press **Ctrl+C** to stop it. There is no `npm install` step for the web build.

Bahasa Indonesia: jalankan perintah di folder hasil ekstrak, lalu buka alamat
di atas. Buka hasil build di `dist`, bukan HTML mentah di `phases`. Ketiga modul
dan pustaka grafik harus tetap berada dalam satu folder. Server hanya menerima
koneksi lokal. Gunakan host dan port yang sama pada sesi berikutnya; browser
menyimpan proyek berdasarkan alamat tersebut. Ekspor cadangan proyek sebelum
menghapus penyimpanan browser.

## Make a portable web bundle

After the build, run `python3 build/package_web.py` (Windows: `py -3 ...`).
The ZIP in `artifacts/` includes all three modules, vendor libraries, offline
assets, licence notices, `START-HERE.txt`, and a per-file hash manifest.
`SHA256SUMS.txt` records the ZIP checksum. Extract the whole bundle on another
computer with Python, then follow `START-HERE.txt`; Node is only needed to build.
For release provenance, pass `--source-ref` with the exact source commit SHA.
The default `local-unrecorded` is deliberately not a verified release claim.

CI retains this complete bundle for each successful build. A workflow artifact
requires GitHub access; it is not necessarily a published release. Use the
release page for published downloads and the source route whenever a web ZIP
is not attached. Do not assume an older tag contains this packaging command.

## Offline use and updates

For the hosted web app, open **Core, Assay and Resource** once while online
before disconnecting. Installing just Core does not load every module. Local
file processing and calculations then work offline; optional Google Drive,
satellite maps and update checks need a connection. Source builds include the
libraries locally. Export project backups before clearing site storage.

Updating the web app does not update an executable or a source checkout.
Download the new release, or pull and rebuild the source. The Core dashboard shows
which version you are running.

## Choose the matching tutorial

The built-in sample is a synthetic nickel laterite (349 collars). It matches the
[10-minute quickstart](vignettes/en/00-quickstart.md)
([Bahasa Indonesia](vignettes/00-quickstart.md)). For real public data use the
[Thalanga tutorial](vignettes/en/01-thalanga-vms.md)
([Bahasa Indonesia](vignettes/01-thalanga-vms.md)) and import its files.
The [four CSV training files](https://github.com/ghoziankarami/orebit-datasets/blob/main/docs/USE_WITH_GEOSUITE.md)
give the same input on every build. Training outputs are screening results.

| Problem | Action |
| --- | --- |
| `node` is not found | Install Node, reopen the terminal, check its version. |
| Windows cannot find Python | Use `py -3`, or install Python and reopen the terminal. |
| Port 8767 is in use | Stop the previous server or choose another port; use that port in the browser. |
| Charts fail or files are missing | Rebuild or extract the whole ZIP, including `vendor/`; serve `dist` over local HTTP. |
| Saved project disappears on a new port/browser | Reopen the original address/profile or import your exported backup. |

For errors, report the source revision, module, operating system, browser and
terminal message through [Issues](https://github.com/ghoziankarami/geosuite/issues).
