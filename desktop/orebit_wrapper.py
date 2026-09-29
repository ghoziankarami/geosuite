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
import errno
import subprocess
import tempfile
import time
import threading
import webbrowser
import tkinter as tk
from tkinter import filedialog, messagebox
from http.server import HTTPServer, SimpleHTTPRequestHandler

# Marker the page reads to know it runs inside the Desktop app (desktop-only
# buttons, the "web version" links hidden). It used to also carry a per-launch
# token for a copy-protection lock screen (inject-guard.py) and a licensee
# name; both were removed after v3.0.0, when GeoSuite became GPL-3.0.
DESKTOP_RUNTIME = {"ok": True, "desktop": True}

WINDOW_SIZE = (1400, 900)
MIN_SIZE = (800, 600)


class FileAPI:
    """Python-side API exposed to JavaScript via pywebview js_api."""

    def __init__(self, module):
        self.module = module

    def send_handoff(self, target, filename, text):
        """Store one CSV for the next module; optionally start its sibling EXE."""
        next_module = {"Core": "Assay", "Assay": "Resource"}.get(self.module)
        if target != next_module or not isinstance(filename, str) or not isinstance(text, str):
            return {"ok": False, "error": "Invalid module handoff"}
        if not filename.lower().endswith(".csv") or len(text.encode("utf-8")) > 32 * 1024 * 1024:
            return {"ok": False, "error": "CSV handoff must be at most 32 MB"}
        try:
            folder = _handoff_dir()
            path = os.path.join(folder, target + ".json")
            fd, temp = tempfile.mkstemp(dir=folder, prefix=target + "-", suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(
                        {"name": os.path.basename(filename), "text": text, "ts": time.time()},
                        f, ensure_ascii=False,
                    )
                os.replace(temp, path)
            finally:
                if os.path.exists(temp):
                    os.unlink(temp)
            exe = os.path.join(os.path.dirname(sys.executable), "Orebit-" + target + ".exe")
            launched = False
            if sys.platform == "win32" and getattr(sys, "frozen", False) and os.path.isfile(exe):
                subprocess.Popen([exe], cwd=os.path.dirname(exe), close_fds=True)
                launched = True
            return {"ok": True, "launched": launched}
        except OSError as exc:
            return {"ok": False, "error": str(exc)}

    def take_handoff(self):
        """Only this EXE can consume its own fresh handoff, and only once."""
        if self.module not in ("Assay", "Resource"):
            return None
        try:
            path = os.path.join(_handoff_dir(), self.module + ".json")
            with open(path, "r", encoding="utf-8") as f:
                rec = json.load(f)
            os.unlink(path)
            if time.time() - rec.get("ts", 0) > 30 * 60 or rec.get("ts", 0) > time.time() + 60:
                return None
            if not isinstance(rec.get("text"), str) or not isinstance(rec.get("name"), str):
                return None
            if len(rec["text"].encode("utf-8")) > 32 * 1024 * 1024:
                return None
            return rec
        except (OSError, ValueError, TypeError):
            return None

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


MODULE_PORTS = {"Core": 18767, "Assay": 18768, "Resource": 18769}


def _module_from_html(html):
    match = re.search(r'<meta name="product-stage" content="(Core|Assay|Resource)"', html)
    if not match:
        raise ValueError("Unknown GeoSuite module in bundled HTML")
    return match.group(1)


def _handoff_dir():
    base = os.environ.get("APPDATA") if sys.platform == "win32" else None
    if not base:
        base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(
            os.path.expanduser("~"), ".config"
        )
    path = os.path.join(base, "Orebit", "handoff")
    os.makedirs(path, exist_ok=True)
    return path


def _bind_server(handler, module):
    """Bind the stable origin first; use an OS-assigned port only if occupied."""
    try:
        return HTTPServer(("127.0.0.1", MODULE_PORTS[module]), handler)
    except OSError as exc:
        if exc.errno not in (errno.EADDRINUSE, errno.EACCES):
            raise
        print(
            f"Port {MODULE_PORTS[module]} unavailable; saved browser projects "
            "will be hidden during this session. Close the other process "
            "and reopen GeoSuite to recover the normal origin.",
            file=sys.stderr,
        )
        return HTTPServer(("127.0.0.1", 0), handler)


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
    anymore; it fails loud and lets the user act instead.
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
                # the app in a browser.
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
    # docs/PLAN-opensource-dan-excellence.md.

    # Read HTML content for title extraction
    with open(html_path, "r", encoding="utf-8") as f:
        html_content = f.read()

    app_title = extract_title(html_content)

    # Start local HTTP server FIRST (avoids WebView2 2MB NavigateToString limit).
    # The server must be up BEFORE any fallback path so that EVERY way of opening
    # the app goes through http://127.0.0.1, never file://: that is where the
    # page gets window.__OREBIT_RT__ (desktop mode) and its default profile.
    base_dir = get_base_dir()
    module = _module_from_html(html_content)

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=base_dir, **kwargs)

        def log_message(self, format, *args):
            pass

        def do_GET(self):
            # Serve index.html with the desktop marker (and an optional default
            # profile) as synchronous scripts, so they exist before the app's
            # own scripts read them.
            if self.path.rstrip("/") in ("", "/index.html"):
                path = os.path.join(base_dir, "index.html")
                if os.path.exists(path):
                    with open(path, "rb") as f:
                        html = f.read()
                    runtime_script = (
                        b"<script>"
                        b"window.__OREBIT_RT__="
                        + json.dumps(DESKTOP_RUNTIME, separators=(",", ":")).encode(
                            "utf-8"
                        )
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
                            runtime_script += (
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
                        html = html[: idx + 6] + runtime_script + html[idx + 6 :]
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(html)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(html)
                    return
            return super().do_GET()

    server = _bind_server(Handler, module)
    port = server.server_port
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    url = f"http://127.0.0.1:{port}/index.html"

    # WebView2 on Windows — auto-install if missing so the native window works.
    # WebView2 on Windows — auto-install if missing so the native window works.
    # We DO NOT silently fall back to webbrowser.open() right away.
    #
    # But: a hard exit on WebView2 install failure is also a dead end for
    # users on locked-down corporate machines where the bootstrapper
    # silently reports "success" but the runtime is incomplete. So we try
    # pywebview first; if every native backend fails, we fall back to the
    # SYSTEM DEFAULT BROWSER (the URL is still http://127.0.0.1:PORT, served
    # by our local server, so the page still runs in desktop mode).
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

        api = FileAPI(module)

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
        # The URL is the local HTTP server we just started, so the desktop
        # marker is still injected — the user gets a working app
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
    HTTP server (not file://), so the page still runs in desktop mode.
    """
    notice_title = "Orebit GeoSuite — Browser Mode"
    if webview2_installed:
        # WebView2 is supposedly installed but the native window still failed.
        # This is almost always a display/GPU issue.
        notice = (
            "Native window tidak dapat dibuka (kemungkinan masalah display/GPU),\n"
            "jadi aplikasi dibuka di browser default kamu.\n\n"
            "Fitur GeoSuite tetap tersedia. Proyek tersimpan mengikuti profil browser yang digunakan.\n\n"
            f"URL: {url}\n\n"
            "Tutup tab browser untuk keluar."
        )
    else:
        # WebView2 itself failed to install. Browser fallback is the only path.
        notice = (
            "WebView2 Runtime tidak berhasil dipasang otomatis,\n"
            "jadi aplikasi dibuka di browser default kamu.\n\n"
            "Fitur GeoSuite tetap tersedia. Proyek tersimpan mengikuti profil browser yang digunakan.\n\n"
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
