"""
Orebit GeoSuite — Desktop Wrapper (v7)
Uses local HTTP server to serve HTML (avoids WebView2 2MB NavigateToString limit).
Window title is extracted from HTML <title> tag.
Includes WebView2 availability check with user-friendly error.
"""

import sys
import os
import re
import json
import base64
import socket
import secrets
import threading
import webbrowser
import tkinter as tk
from tkinter import filedialog, messagebox
from http.server import HTTPServer, SimpleHTTPRequestHandler

# Per-launch runtime token. The bundled index.html carries a guard script
# (inject-guard.py) that waits for this token before showing the UI. It dates
# from the paid-licence era; since v3.0.0 (GPL-3.0) it protects nothing, since
# the source is public, and is kept only until it can be removed together
# with the EXE tests that assert it.
RUNTIME_TOKEN = secrets.token_urlsafe(24)

# Licensee identity slots for the "Licensed to" watermark. Always empty since
# v3.0.0 (GPL-3.0, no activation): kept only so the payload shape the page
# reads does not change.
LICENSEE = {"e": "", "o": ""}

WINDOW_SIZE = (1400, 900)
MIN_SIZE = (800, 600)


class FileAPI:
    """Python-side API exposed to JavaScript via pywebview js_api."""

    def save_file(self, filename, content_b64, mime="application/octet-stream"):
        """Save a file from base64-encoded content. Returns path or None."""
        try:
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)

            ext = os.path.splitext(filename)[1] if filename else ""
            filetypes = [("All files", "*.*")]
            if ext == ".csv":
                filetypes = [("CSV files", "*.csv")] + filetypes
            elif ext == ".pdf":
                filetypes = [("PDF files", "*.pdf")] + filetypes
            elif ext == ".orebit":
                filetypes = [("Orebit project", "*.orebit")] + filetypes

            path = filedialog.asksaveasfilename(
                initialfile=filename,
                filetypes=filetypes,
                defaultextension=ext,
                title=f"Save {filename}",
            )
            root.destroy()

            if not path:
                return None

            data = base64.b64decode(content_b64)
            with open(path, "wb") as f:
                f.write(data)
            return path
        except Exception as e:
            return f"ERROR: {e}"


def _webview_storage_path():
    """Where the webview keeps IndexedDB / localStorage between launches.

    One per-user root (<base>/Orebit/webview), so the folder holds everything
    Orebit stores on this machine: it can be named to a user, backed up,
    or deleted in one go. Deliberately not a temp dir — that is exactly the
    default this replaces.
    """
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support")
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(
            os.path.expanduser("~"), ".config"
        )
    path = os.path.join(base, "Orebit", "webview")
    try:
        os.makedirs(path, exist_ok=True)
    except OSError:
        # Read-only or locked-down profile: fall back to pywebview's own
        # default rather than refusing to open. Data will not persist, which
        # is the old behaviour, not a new failure.
        return None
    return path


def get_base_dir():
    """Get base directory (bundled by PyInstaller or relative)."""
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


def get_html_path():
    """Get HTML file path."""
    return os.path.join(get_base_dir(), "index.html")


def extract_title(html_content):
    """Extract title from HTML <title> tag, fallback to default."""
    match = re.search(r"<title>([^<]+)</title>", html_content, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return "Orebit GeoSuite"


def find_port():
    """Find an available port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def check_webview2():
    """Check if WebView2 Runtime is installed on Windows.

    Checks multiple reliable registry paths AND the install directory
    (some users have the runtime but missing/limited registry perms).
    """
    if sys.platform != "win32":
        return True

    # Method 1: HKLM EdgeUpdate Clients (32-bit, admin-installed runtime)
    try:
        import winreg

        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BEB-235B8DB523D0}",
        )
        winreg.CloseKey(key)
        return True
    except Exception:
        pass

    # Method 2: HKCU EdgeUpdate Clients (per-user install)
    try:
        import winreg

        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BEB-235B8DB523D0}",
        )
        winreg.CloseKey(key)
        return True
    except Exception:
        pass

    # Method 3: Install directory check (most reliable — works even with
    # broken/missing registry entries, e.g. corporate policies)
    import os as _os

    candidates = [
        _os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\EdgeWebView\Application"),
        _os.path.expandvars(r"%ProgramFiles%\Microsoft\EdgeWebView\Application"),
        _os.path.expandvars(r"%LocalAppData%\Microsoft\EdgeWebView\Application"),
    ]
    for path in candidates:
        try:
            if _os.path.isdir(path):
                # Look for an exe in any version subdirectory
                for entry in _os.listdir(path):
                    full = _os.path.join(path, entry, "msedgewebview2.exe")
                    if _os.path.isfile(full):
                        return True
        except Exception:
            continue

    return False


def install_webview2_with_ui():
    """Install the WebView2 Runtime with a visible Tk progress popup.

    Resolution order for the bootstrapper (smaller is better — fully offline):
      1. Bundled: <base_dir>/MicrosoftEdgeWebview2Setup.exe  (shipped in ZIP)
      2. System PATH: MicrosoftEdgeWebview2Setup.exe
      3. Download:    https://go.microsoft.com/fwlink/p/?LinkId=2124703

    Returns True on success (runtime now present), False on failure. The popup
    gives the user feedback during the one-time ~100MB install so the app
    never looks frozen, and reports a clear success/failed outcome. Network +
    install run on a worker thread; the Tk mainloop keeps the window painting.

    If the install FAILS and the bundled bootstrapper was used, the popup
    surfaces a clear "download manually" CTA so the user always knows
    the next step. The caller (main) does NOT fall back to webbrowser.open()
    anymore — opening the app in a browser can bypass the guard, so we
    fail loud and let the user act instead.
    """
    import urllib.request
    import tempfile
    import subprocess
    import os as _os

    bootstrapper_url = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
    bundled_new = _os.path.join(get_base_dir(), "install-webview2-runtime.exe")
    bundled_legacy = _os.path.join(get_base_dir(), "MicrosoftEdgeWebview2Setup.exe")

    def resolve_bootstrapper():
        """Return (path, source_label) where path is where the bootstrapper
        can be read from and source_label describes where it came from
        (for the install UI)."""
        # 1. Bundled inside the EXE/PYZ (best — fully offline, no network).
        #    Preferred name: install-webview2-runtime.exe (user-friendly).
        #    Legacy: MicrosoftEdgeWebview2Setup.exe (kept for back-compat with
        #    ZIPs built before the rename).
        if _os.path.exists(bundled_new):
            return bundled_new, "bundled"
        if _os.path.exists(bundled_legacy):
            return bundled_legacy, "bundled-legacy"
        # 2. On PATH (admin pre-installed the bootstrapper somewhere).
        from shutil import which

        w = which("MicrosoftEdgeWebview2Setup.exe") or which(
            "install-webview2-runtime.exe"
        )
        if w:
            return w, "system"
        # 3. Download from Microsoft's evergreen URL.
        tmp = _os.path.join(tempfile.gettempdir(), "WebView2Setup.exe")
        try:
            urllib.request.urlretrieve(bootstrapper_url, tmp)
            return tmp, "downloaded"
        except Exception as e:
            return None, f"download-failed: {e}"

    # State shared between worker thread and the Tk UI.
    state = {"phase": "prepare", "done": False, "ok": False, "err": "", "src": ""}

    try:
        win = tk.Tk()
    except Exception as e:
        # No display / Tk unavailable — silent install path. If anything goes
        # wrong here we propagate the error so the caller can show a clear
        # message instead of silently falling back to a browser.
        print(
            f"WebView2 UI unavailable ({e}); silent install fallback.",
            file=sys.stderr,
        )
        path, src = resolve_bootstrapper()
        if path is None:
            print(f"WebView2 bootstrapper not available: {src}", file=sys.stderr)
            return False
        try:
            subprocess.run([path, "/silent", "/install"], check=True, timeout=180)
            if src == "downloaded":
                try:
                    _os.unlink(path)
                except Exception:
                    pass
            return bool(check_webview2())
        except Exception as e2:
            print(f"WebView2 silent install failed: {e2}", file=sys.stderr)
            return False

    win.title("Orebit GeoSuite — Setup")
    win.geometry("440x180")
    win.resizable(False, False)
    win.configure(bg="#0f172a")
    try:
        win.attributes("-topmost", True)
    except Exception:
        pass

    # Center on screen.
    win.update_idletasks()
    sw, sh = win.winfo_screenwidth(), win.winfo_screenheight()
    win.geometry(f"440x180+{(sw - 440) // 2}+{(sh - 180) // 2}")

    tk.Label(
        win,
        text="Menyiapkan Orebit GeoSuite",
        font=("Segoe UI", 13, "bold"),
        fg="#f1f5f9",
        bg="#0f172a",
    ).pack(pady=(24, 4))

    status_var = tk.StringVar(value="Mempersiapkan installer WebView2…")
    tk.Label(
        win,
        textvariable=status_var,
        font=("Segoe UI", 9),
        fg="#94a3b8",
        bg="#0f172a",
        wraplength=400,
    ).pack(pady=(0, 12))

    # Indeterminate progress via ttk if available, else an animated text bar.
    bar_var = tk.StringVar(value="")
    try:
        from tkinter import ttk

        pb = ttk.Progressbar(win, mode="indeterminate", length=380)
        pb.pack(pady=4)
        pb.start(12)
        _use_ttk = True
    except Exception:
        _use_ttk = False
        tk.Label(
            win, textvariable=bar_var, font=("Consolas", 11), fg="#14b8a6", bg="#0f172a"
        ).pack(pady=4)

    tk.Label(
        win,
        text="Hanya sekali saat pertama membuka aplikasi.",
        font=("Segoe UI", 8),
        fg="#64748b",
        bg="#0f172a",
    ).pack(side="bottom", pady=(0, 12))

    def worker():
        try:
            path, src = resolve_bootstrapper()
            if path is None:
                # No bootstrapper anywhere. Surface the download URL so the
                # user has an obvious next step.
                state["err"] = (
                    "Installer WebView2 tidak tersedia.\n"
                    f"Otomatis gagal: {src}\n\n"
                    "Solusi: download manual di\n"
                    "https://developer.microsoft.com/en-us/microsoft-edge/webview2/\n"
                    "Pilih 'Evergreen Standalone Installer' (MicrosoftEdgeWebview2Setup.exe).\n"
                    "Letakkan di folder yang sama dengan Orebit-*.exe, lalu jalankan ulang."
                )
                state["ok"] = False
                return
            state["src"] = src
            if src == "downloaded":
                state["phase"] = "download"
                # status_var.set is called from the main thread via the poll loop
                # after `state["phase"]` flips; just bump the phase here.
            state["phase"] = "install"
            subprocess.run([path, "/silent", "/install"], check=True, timeout=180)
            if src == "downloaded":
                try:
                    _os.unlink(path)
                except Exception:
                    pass
            state["ok"] = check_webview2()
        except Exception as e:
            state["err"] = str(e)
            state["ok"] = False
        finally:
            state["done"] = True

    threading.Thread(target=worker, daemon=True).start()

    tick = {"n": 0}

    def poll():
        tick["n"] += 1
        if not _use_ttk:
            frames = [
                "[=     ]",
                "[==    ]",
                "[===   ]",
                "[ ===  ]",
                "[  === ]",
                "[   ===]",
                "[    ==]",
                "[     =]",
            ]
            bar_var.set(frames[tick["n"] % len(frames)])
        if state["phase"] == "download":
            status_var.set("Mengunduh WebView2 Runtime (~1.6 MB bootstrapper)…")
        elif state["phase"] == "install":
            if state["src"] == "bundled":
                status_var.set("Memasang WebView2 dari installer offline (~100 MB)…")
            else:
                status_var.set("Memasang WebView2 Runtime… mohon tunggu.")
        if state["done"]:
            if state["ok"]:
                status_var.set("✓ WebView2 berhasil dipasang. Membuka aplikasi…")
                if _use_ttk:
                    try:
                        pb.stop()
                        pb.configure(mode="determinate", value=100)
                    except Exception:
                        pass
                win.after(1100, win.destroy)
            else:
                # FAIL — show clear next-step UI instead of silently opening
                # the app in a browser (which would bypass the guard).
                if _use_ttk:
                    try:
                        pb.stop()
                    except Exception:
                        pass
                for w in win.winfo_children():
                    try:
                        w.destroy()
                    except Exception:
                        pass
                win.geometry("540x360")
                tk.Label(
                    win,
                    text="WebView2 gagal dipasang",
                    font=("Segoe UI", 14, "bold"),
                    fg="#fca5a5",
                    bg="#0f172a",
                ).pack(pady=(24, 8))
                tk.Label(
                    win,
                    text=state["err"] or "Error tidak diketahui.",
                    font=("Segoe UI", 9),
                    fg="#f1f5f9",
                    bg="#0f172a",
                    wraplength=500,
                    justify="left",
                ).pack(padx=20, pady=8)
                tk.Label(
                    win,
                    text="Setelah install WebView2 berhasil, jalankan ulang Orebit-*.exe.",
                    font=("Segoe UI", 9, "italic"),
                    fg="#94a3b8",
                    bg="#0f172a",
                    wraplength=500,
                ).pack(padx=20, pady=(4, 12))
                tk.Button(
                    win,
                    text="Tutup",
                    font=("Segoe UI", 10, "bold"),
                    command=win.destroy,
                    bg="#1e293b",
                    fg="#f1f5f9",
                    activebackground="#334155",
                    activeforeground="#f1f5f9",
                    padx=20,
                    pady=6,
                ).pack(pady=(8, 16))
                # Don't auto-close — user must read the error.
            return
        win.after(120, poll)

    win.after(120, poll)
    try:
        win.mainloop()
    except Exception:
        pass

    return bool(state["ok"])


def main():
    html_path = get_html_path()

    if not os.path.exists(html_path):
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("Orebit GeoSuite", f"ERROR: {html_path}\nnot found")
        root.destroy()
        sys.exit(1)

    # No licence gate (removed 2026-09-25): GeoSuite is GPL-3.0 open source and
    # every module is free, web and Desktop -- owner decision O2 in
    # docs/PLAN-opensource-dan-excellence.md. LICENSEE stays empty, so no
    # licensee watermark and no key is synced into the page.
    global LICENSEE
    LICENSEE = {"e": "", "o": ""}

    # Read HTML content for title extraction
    with open(html_path, "r", encoding="utf-8") as f:
        html_content = f.read()

    app_title = extract_title(html_content)

    # Start local HTTP server FIRST (avoids WebView2 2MB NavigateToString limit).
    # The server must be up BEFORE any fallback path so that EVERY way of opening
    # the app goes through http://127.0.0.1, never file://: the bundled guard
    # script locks a page opened via file://, so a file:// fallback would show
    # the user a lock screen instead of the app.
    base_dir = get_base_dir()
    port = find_port()

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=base_dir, **kwargs)

        def log_message(self, format, *args):
            pass

        def do_GET(self):
            # Runtime handshake endpoint for the bundled guard (Level A).
            # Only reachable from inside this wrapper's local server, so a copied
            # index.html opened elsewhere cannot obtain the token.
            if self.path.split("?", 1)[0] == "/__orebit_rt__":
                body = json.dumps(
                    {
                        "ok": True,
                        "t": RUNTIME_TOKEN,
                        "lic": LICENSEE.get("e", ""),
                        "ord": LICENSEE.get("o", ""),
                    }
                ).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            # Serve index.html with the runtime token injected directly into the
            # page. This eliminates the fetch() race condition that causes the IP
            # guard to block the UI when WebView2 is slow to connect or when the
            # fallback-browser path is taken. The guard reads window.__OREBIT_RT__
            # synchronously before its own fetch would fire.
            if self.path.rstrip("/") in ("", "/index.html"):
                path = os.path.join(base_dir, "index.html")
                if os.path.exists(path):
                    with open(path, "rb") as f:
                        html = f.read()
                    # Inject runtime token as a synchronous window var so the guard
                    # can read it immediately (no fetch, no race).
                    token_script = (
                        b"<script>"
                        b"window.__OREBIT_RT__="
                        + json.dumps(
                            {
                                "ok": True,
                                "t": RUNTIME_TOKEN,
                                "lic": LICENSEE.get("e", ""),
                                "ord": LICENSEE.get("o", ""),
                            },
                            separators=(",", ":"),
                        ).encode("utf-8")
                        + b";</script>"
                    )
                    # Optional default profile from __OREBIT_DEFAULT_PROFILE__. This
                    # runs before the app reads localStorage, so the user sees
                    # that name instead of "Geologist" on first launch.
                    profile_env = os.environ.get("__OREBIT_DEFAULT_PROFILE__")
                    if profile_env:
                        try:
                            profile_json = json.dumps(
                                json.loads(profile_env), separators=(",", ":")
                            )
                            token_script += (
                                b"<script>"
                                b"try{var p=" + profile_json.encode("utf-8") + b";"
                                b"if(!localStorage.getItem('orebit_profile'))"
                                b"{localStorage.setItem('orebit_profile',JSON.stringify(p));}"  # noqa: E501
                                b"}catch(e){}</script>"
                            )
                        except Exception:
                            pass
                    idx = html.find(b"<body>")
                    if idx != -1:
                        html = html[: idx + 6] + token_script + html[idx + 6 :]
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(html)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(html)
                    return
            return super().do_GET()

    server = HTTPServer(("127.0.0.1", port), Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    url = f"http://127.0.0.1:{port}/index.html"

    # WebView2 on Windows — auto-install if missing so the native window works.
    # WebView2 on Windows — auto-install if missing so the native window works.
    # We DO NOT silently fall back to webbrowser.open() — opening the app in the
    # system browser can bypass the guard handshake.
    #
    # But: a hard exit on WebView2 install failure is also a dead end for
    # users on locked-down corporate machines where the bootstrapper
    # silently reports "success" but the runtime is incomplete. So we try
    # pywebview first; if every native backend fails, we fall back to the
    # SYSTEM DEFAULT BROWSER (the URL is still http://127.0.0.1:PORT, served
    # by our local server, so the guard runtime token still works).
    webview2_installed = True
    if sys.platform == "win32" and not check_webview2():
        print("WebView2 Runtime not found. Auto-installing...", file=sys.stderr)
        installed_ok = install_webview2_with_ui()
        if installed_ok and check_webview2():
            print("WebView2 installed successfully.", file=sys.stderr)
        else:
            # Don't hard-fail — let the pywebview start attempt below surface
            # the real error. If pywebview also fails, we then fall back to
            # the system browser with a clear notice.
            print(
                "WebView2 install may have failed. Will attempt native window anyway.",
                file=sys.stderr,
            )
            webview2_installed = False

    # Try pywebview first (native window), fall back to system browser
    try:
        import webview

        api = FileAPI()

        gui_options = ["edgechromium", "mshtml", "gtk", "qt"]
        last_err = None
        for gui in gui_options:
            try:
                webview.create_window(
                    title=app_title,
                    url=url,
                    width=WINDOW_SIZE[0],
                    height=WINDOW_SIZE[1],
                    min_size=MIN_SIZE,
                    resizable=True,
                    text_select=True,
                    confirm_close=True,
                    js_api=api,
                )
                # private_mode=False + a fixed storage_path. Without both,
                # pywebview defaults to private_mode=True, which hands the
                # webview a throwaway profile in a randomly-named temp folder
                # — a different one every launch (measured 2026-09-06:
                # Temp\tmp94a4_jky\EBWebView then Temp\tmp3te8dp_4\EBWebView),
                # left behind on disk afterwards.
                #
                # Everything the browser side persists therefore died on close
                # in the Desktop Edition while working fine in the web build:
                # saved projects (IndexedDB), the "last project" key that
                # autoLoadLastProject() reads, the language choice, dismissed
                # banners, Resource's saved variogram/block settings. "Save
                # Project" appeared to work and was gone next launch.
                #
                # Placed under one Orebit folder per user on purpose: it can
                # be pointed at, backed up, or deleted, instead of an
                # unnameable temp directory.
                webview.start(
                    gui=gui,
                    debug=False,
                    private_mode=False,
                    storage_path=_webview_storage_path(),
                )
                server.shutdown()
                return
            except Exception as _e:
                last_err = _e
                continue

        # Every native backend failed. Fall back to the system default browser.
        # The URL is the local HTTP server we just started, so the guard
        # runtime token is still injected — the user gets a working app
        # in their default browser, with a clear one-time notice about why.
        raise ImportError(f"No pywebview backend available (last: {last_err})")

    except Exception as e:
        # Native window failed. Offer the system browser as a fallback so the
        # user always has a way to open the app.
        _open_in_system_browser_with_notice(url, str(e), webview2_installed)
        # Keep the local HTTP server alive while the browser tab is open.
        # User closes the browser tab to release everything.
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.shutdown()


def _open_in_system_browser_with_notice(url, err_msg, webview2_installed):
    """Open the app in the system default browser with a clear notice.

    Used as a fallback when the native pywebview window cannot start (e.g.
    WebView2 install is broken, no display, GPU issue). The URL is the local
    HTTP server (not file://), so the guard runtime token still works.
    """
    notice_title = "Orebit GeoSuite — Browser Mode"
    if webview2_installed:
        # WebView2 is supposedly installed but the native window still failed.
        # This is almost always a display/GPU issue.
        notice = (
            "Native window tidak dapat dibuka (kemungkinan masalah display/GPU),\n"
            "jadi aplikasi dibuka di browser default kamu.\n\n"
            "Semua fitur (termasuk aktivasi lisensi & watermark) tetap bekerja normal.\n\n"
            f"URL: {url}\n\n"
            "Tutup tab browser untuk keluar."
        )
    else:
        # WebView2 itself failed to install. Browser fallback is the only path.
        notice = (
            "WebView2 Runtime tidak berhasil dipasang otomatis,\n"
            "jadi aplikasi dibuka di browser default kamu.\n\n"
            "Semua fitur (termasuk aktivasi lisensi & watermark) tetap bekerja normal.\n\n"
            "Untuk window native di kemudian hari, install manual:\n"
            "  https://developer.microsoft.com/en-us/microsoft-edge/webview2/\n\n"
            f"URL: {url}\n\n"
            "Tutup tab browser untuk keluar."
        )
    print(
        notice_title + "\n" + notice + "\n--- detail ---\n" + err_msg, file=sys.stderr
    )
    try:
        root = tk.Tk()
        root.withdraw()
        messagebox.showinfo(notice_title, notice)
        root.destroy()
    except Exception:
        # No Tk — the stderr message above is the only signal, but the browser
        # still opens. User will figure it out from the URL.
        pass
    try:
        webbrowser.open(url)
    except Exception as _e:
        print(f"Failed to open browser: {_e}", file=sys.stderr)


def _show_webview2_failure_and_exit(message):
    """Show a Tk error dialog and exit. No silent browser fallback."""
    try:
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("Orebit GeoSuite — Error", message)
        root.destroy()
    except Exception:
        # No Tk either — print to stderr and bail.
        print("FATAL:", message, file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
