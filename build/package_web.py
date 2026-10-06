"""Package the complete local web app, with deterministic bytes and provenance.

Run after `npm run build`. Python standard library only.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = ["Core.html", "Assay.html", "Resource.html", "manifest.webmanifest",
            "service-worker.js", "pwa/icon-192.png", "pwa/icon-512.png",
            "pwa/icon-maskable-512.png", "pwa/apple-touch-icon.png",
            "vendor/plotly.min.js", "vendor/jspdf.umd.min.js",
            "vendor/html2canvas.min.js", "vendor/jszip.min.js"]


def package(root, output, source_ref="local-unrecorded"):
    dist = root / "dist"
    missing = [name for name in REQUIRED if not (dist / name).is_file()]
    if missing:
        raise ValueError("Incomplete build; missing: " + ", ".join(missing))
    version = json.loads((root / "package.json").read_text())["version"]
    files = {"dist/" + name: (dist / name).read_bytes() for name in REQUIRED}
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        files[name] = (root / name).read_bytes()
    files["START-HERE.txt"] = (
        "GeoSuite local web application\n\n"
        "Extract the whole ZIP, including dist/vendor and dist/pwa.\n"
        "From this folder run: python3 -m http.server 8767 --bind 127.0.0.1 -d dist\n"
        "Windows: py -3 -m http.server 8767 --bind 127.0.0.1 -d dist\n"
        "Open http://127.0.0.1:8767/Core.html (also Assay.html and Resource.html).\n"
        "Keep the server running. Do not open HTML using file://.\n"
        "Local calculations work offline. Drive, satellite maps and updates need internet.\n"
        "Keep the same host and port to retain browser storage; export project backups.\n"
        "Check the bundled sample name before choosing a tutorial.\n"
        "Source and installation: https://github.com/ghoziankarami/geosuite\n"
    ).encode()
    manifest = {"schema_version": 1, "version": version, "source_ref": source_ref,
                "files": {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                          for name, data in sorted(files.items())}}
    files["BUILD-MANIFEST.json"] = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"geosuite-{version}-web.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zip_file:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            zip_file.writestr(info, data, compresslevel=9)
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    (output / "SHA256SUMS.txt").write_text(f"{checksum}  {archive.name}\n")
    return archive


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts")
    parser.add_argument("--source-ref", default="local-unrecorded")
    args = parser.parse_args()
    print(package(ROOT, args.output, args.source_ref))
