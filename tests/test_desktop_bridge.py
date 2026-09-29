#!/usr/bin/env python3
"""Desktop origin and one-time handoff contracts (no native GUI required)."""
import json
import os
import socket
import sys
import tempfile
import time
import unittest
from http.server import SimpleHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "desktop"))
import orebit_wrapper as wrapper


class DesktopBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.old_appdata = os.environ.get("APPDATA")
        self.old_xdg = os.environ.get("XDG_CONFIG_HOME")
        os.environ["APPDATA"] = self.temp.name
        os.environ["XDG_CONFIG_HOME"] = self.temp.name
        self.addCleanup(self.restore_env)

    def restore_env(self):
        for key, value in (("APPDATA", self.old_appdata), ("XDG_CONFIG_HOME", self.old_xdg)):
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_stable_ports_and_fallback(self):
        self.assertEqual(wrapper.MODULE_PORTS, {"Core": 18767, "Assay": 18768, "Resource": 18769})
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        old = wrapper.MODULE_PORTS["Core"]
        wrapper.MODULE_PORTS["Core"] = port
        self.addCleanup(lambda: wrapper.MODULE_PORTS.__setitem__("Core", old))
        first = wrapper._bind_server(SimpleHTTPRequestHandler, "Core")
        self.addCleanup(first.server_close)
        self.assertEqual(first.server_port, port)
        second = wrapper._bind_server(SimpleHTTPRequestHandler, "Core")
        self.addCleanup(second.server_close)
        self.assertNotEqual(second.server_port, port)

    def test_handoff_is_validated_and_consumed_once(self):
        core, assay = wrapper.FileAPI("Core"), wrapper.FileAPI("Assay")
        self.assertFalse(core.send_handoff("Resource", "x.csv", "a,b")["ok"])
        self.assertFalse(core.send_handoff("Assay", "x.exe", "a,b")["ok"])
        self.assertFalse(core.send_handoff("Assay", "x.csv", "x" * (32 * 1024 * 1024 + 1))["ok"])
        result = core.send_handoff("Assay", "sample.csv", "hole_id,grade\\nA,1\\n")
        self.assertTrue(result["ok"])
        self.assertFalse(result["launched"])  # running this test from source, no sibling EXE
        got = assay.take_handoff()
        self.assertEqual(got["name"], "sample.csv")
        self.assertEqual(got["text"], "hole_id,grade\\nA,1\\n")
        self.assertIsNone(assay.take_handoff())

    def test_stale_handoff_is_discarded(self):
        wrapper.FileAPI("Core").send_handoff("Assay", "a.csv", "x")
        path = Path(wrapper._handoff_dir()) / "Assay.json"
        record = json.loads(path.read_text(encoding="utf-8"))
        record["ts"] = time.time() - 3600
        path.write_text(json.dumps(record), encoding="utf-8")
        self.assertIsNone(wrapper.FileAPI("Assay").take_handoff())
        self.assertFalse(path.exists())
        path.write_text('[]', encoding="utf-8")
        self.assertIsNone(wrapper.FileAPI("Assay").take_handoff())


if __name__ == "__main__":
    unittest.main()
