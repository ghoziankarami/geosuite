"""Prove the distributed ZIP is complete, reproducible and locally servable."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
import urllib.request
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("package_web", ROOT / "build/package_web.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class WebPackage(unittest.TestCase):
    def test_unpacked_app_and_vendor_files_serve_and_match_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            archive = module.package(ROOT, output, "test-revision")
            first = archive.read_bytes()
            self.assertEqual(first, module.package(ROOT, output, "test-revision").read_bytes())
            self.assertTrue((output / "SHA256SUMS.txt").read_text().startswith(hashlib.sha256(first).hexdigest()))
            unpacked = output / "unpacked"
            with zipfile.ZipFile(archive) as zip_file:
                zip_file.extractall(unpacked)
            manifest = json.loads((unpacked / "BUILD-MANIFEST.json").read_text())
            self.assertEqual(manifest["source_ref"], "test-revision")
            server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(unpacked / "dist")))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for name, record in manifest["files"].items():
                    data = (unpacked / name).read_bytes()
                    self.assertEqual(len(data), record["bytes"])
                    self.assertEqual(hashlib.sha256(data).hexdigest(), record["sha256"])
                    if name.startswith("dist/"):
                        url = f"http://127.0.0.1:{server.server_port}/{name[5:]}"
                        with urllib.request.urlopen(url) as response:
                            self.assertEqual(response.read(), data)
                self.assertFalse(any(".bak-" in p.name for p in unpacked.rglob("*")))
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_missing_vendor_fails_instead_of_shipping_broken_html(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            shutil.copytree(ROOT / "dist", root / "dist")
            (root / "dist/vendor/plotly.min.js").unlink()
            with self.assertRaisesRegex(ValueError, "vendor/plotly.min.js"):
                module.package(root, root / "output")


if __name__ == "__main__":
    unittest.main()
