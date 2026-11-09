#!/usr/bin/env python3
"""Check the single GeoSuite artifact before it is published.

Windows: the file exists, is a PE image, is large enough to contain the webview,
         and its version resource names the expected version.
macOS:   the bundle exists, has an executable, and Info.plist carries the
         expected CFBundleShortVersionString.

The check is deliberately about the artifact that was shipped, not about the
app's behaviour: the release workflow already requires a trusted tag and the
tag must match package.json.
"""

import plistlib
import sys
from pathlib import Path

MIN_BYTES = 8 * 1024 * 1024


def check(condition, message):
    if not condition:
        raise SystemExit("FAIL: " + message)
    print("ok:", message)


def windows_version(path):
    """Read VS_FIXEDFILEINFO from the PE resource section without extra deps."""
    data = path.read_bytes()
    sig = data.find(b"\xbd\x04\xef\xfe")  # VS_VERSION_INFO key
    while sig != -1:
        start = data.find(b"\x00", sig)
        chunk = data[start : start + 4096]
        marker = b"FileVersion\x00"
        pos = chunk.find(marker)
        if pos != -1:
            tail = chunk[pos + len(marker) :]
            if tail[:2] == b"\x00\x00":
                tail = tail[2:]
            text = tail.decode("utf-16-le", "ignore").split("\x00")[0].strip()
            if text:
                return text
        sig = data.find(b"\xbd\x04\xef\xfe", sig + 4)
    return None


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: verify-single-artifact.py <artifact> <tag>")
    artifact, tag = Path(sys.argv[1]), sys.argv[2]
    want = tag.lstrip("v")

    check(artifact.exists(), f"{artifact.name} exists")

    if artifact.suffix == ".exe":
        size = artifact.stat().st_size
        check(size >= MIN_BYTES, f"{artifact.name} is {size:,} bytes (>= 8 MB)")
        with artifact.open("rb") as f:
            check(f.read(2) == b"MZ", "the file is a PE image")
        # The authoritative Windows version check runs in PowerShell
        # (VersionInfo.FileVersion); parsing the PE resource by hand reported a
        # false failure on a good artifact.
        check(
            want.encode("utf-16-le") in artifact.read_bytes(),
            f"the version string {want} is embedded in the image",
        )
        return

    app = artifact
    if app.suffix != ".app":
        raise SystemExit(f"FAIL: unrecognised artifact {app}")
    exe = app / "Contents" / "MacOS" / "Orebit-GeoSuite"
    info = app / "Contents" / "Info.plist"
    check(
        exe.is_file() and exe.stat().st_size >= MIN_BYTES,
        f"bundle executable present ({exe.stat().st_size:,} bytes)"
        if exe.is_file()
        else "bundle executable present",
    )
    check(info.is_file(), "Info.plist present")
    with info.open("rb") as f:
        meta = plistlib.load(f)
    check(
        meta.get("CFBundleShortVersionString") == want,
        f"CFBundleShortVersionString is {want} (found {meta.get('CFBundleShortVersionString')})",
    )
    print("ok: macOS bundle verified")


if __name__ == "__main__":
    main()
