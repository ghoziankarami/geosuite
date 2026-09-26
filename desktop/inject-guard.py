#!/usr/bin/env python3
"""
Orebit runtime guard injector (legacy)

Injects a small inline guard <script> immediately after <body> in a built
index.html. The guard blocks the UI with a lock overlay until it can complete
a runtime handshake with the official Orebit wrapper's local HTTP server
(GET /__orebit_rt__ -> {"ok":true,"t":"<token>"}).

HISTORY: written when the Desktop Edition was sold, to stop a copy of the
bundled index.html from running outside the EXE. Since v3.0.0 GeoSuite is
GPL-3.0 and the same app is on the web and in this repository, so the guard
protects nothing. It stays until it is removed together with the EXE tests
that assert it; the "Licensed to" watermark below never shows (the wrapper
always sends an empty licensee).

SCOPE: injected ONLY into the EXE's bundled index.html, at build time. Not in
phases/*.html or the web build.

Idempotent: re-running will not inject twice (checks for the marker).

Usage:
    python3 inject-guard.py /path/to/index.html
"""

import sys

MARKER = "__orebit_guard__"

GUARD = """<script data-orebit-guard="1">
/* Orebit runtime guard (legacy). Removed instantly when run via the desktop app. */
(function(){
  var OV_ID="__orebit_guard__";
  function makeOverlay(){
    var ov=document.createElement("div");
    ov.id=OV_ID;
    ov.setAttribute("style","position:fixed;inset:0;z-index:2147483647;background:#0b0f14;color:#e6edf3;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',system-ui,sans-serif;text-align:center;padding:32px;");
    ov.innerHTML='<div style="max-width:540px"><div style="font-size:44px;margin-bottom:14px">&#128274;</div><h2 style="margin:0 0 10px;font-weight:600;font-size:22px">Orebit \\u2014 official app required</h2><p style="color:#9fb0c0;line-height:1.6;margin:0;font-size:14px">This copy of GeoSuite runs inside the desktop app.<br><br>Launch <b>Orebit</b> from its EXE, or use the free web version at <span style="color:#7aa2f7">geosuite.orebit.id</span>. Need help? <span style="color:#7aa2f7">support@orebit.id</span></p></div>';
    return ov;
  }
  function block(){ try{ if(!document.getElementById(OV_ID)){ (document.body||document.documentElement).appendChild(makeOverlay()); } }catch(e){} }
  function pass(){ try{ var g=document.getElementById(OV_ID); if(g){ g.parentNode.removeChild(g); } }catch(e){} }
  function watermark(email, order){
    try{
      if(!email) return;
      if(document.getElementById("__orebit_wm__")) return;
      var wm=document.createElement("div");
      wm.id="__orebit_wm__";
      wm.setAttribute("style","position:fixed;left:10px;bottom:8px;z-index:2147483000;font-family:'Segoe UI',system-ui,sans-serif;font-size:11px;color:rgba(120,140,160,0.55);pointer-events:none;user-select:none;white-space:nowrap;");
      var label="Licensed to: "+email;
      if(order) label+=" \\u00b7 Order "+order;
      wm.textContent=label;
      (document.body||document.documentElement).appendChild(wm);
    }catch(e){}
  }
  function start(){
    block();
    try{
      // Fast path: token already injected by the wrapper's local HTTP server
      // (orebit_wrapper.py serves index.html with window.__OREBIT_RT__ set).
      // This avoids the fetch() round-trip and eliminates the race condition
      // where WebView2 is slow to connect or the browser-fallback path is taken.
      if(typeof window.__OREBIT_RT__ === "object" && window.__OREBIT_RT__ && window.__OREBIT_RT__.ok === true && typeof window.__OREBIT_RT__.t === "string" && window.__OREBIT_RT__.t.length >= 16){
        pass();
        watermark(window.__OREBIT_RT__.lic, window.__OREBIT_RT__.ord);
        return;
      }
      if(location.protocol==="file:"){ block(); return; }
      fetch("/__orebit_rt__",{cache:"no-store"}).then(function(r){ return r.ok?r.json():null; }).then(function(j){
        if(j && j.ok===true && typeof j.t==="string" && j.t.length>=16){ pass(); watermark(j.lic, j.ord); } else { block(); }
      }).catch(function(){ block(); });
    }catch(e){ block(); }
  }
  function hardenInput(){
    try{
      document.addEventListener("contextmenu", function(e){ e.preventDefault(); }, true);
      document.addEventListener("keydown", function(e){
        var k=(e.key||"").toLowerCase();
        if(e.key==="F12"){ e.preventDefault(); return; }
        if((e.ctrlKey||e.metaKey)){
          if(k==="s"||k==="u"){ e.preventDefault(); return; }
          if(e.shiftKey && (k==="i"||k==="j"||k==="c")){ e.preventDefault(); return; }
        }
      }, true);
      document.addEventListener("dragstart", function(e){ e.preventDefault(); }, true);
    }catch(e){}
  }
  if(document.body){ start(); hardenInput(); }
  else if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded",function(){ start(); hardenInput(); }); }
  else { start(); hardenInput(); }
})();
</script>
"""


def inject(path):
    with open(path, "r", encoding="utf-8") as f:
        html = f.read()

    if MARKER in html:
        print(f"  guard already present in {path} (skipped)")
        return 0

    idx = html.find("<body>")
    if idx == -1:
        # try <body ...>
        import re

        m = re.search(r"<body[^>]*>", html, re.IGNORECASE)
        if not m:
            print(f"ERROR: no <body> tag found in {path}", file=sys.stderr)
            return 1
        insert_at = m.end()
    else:
        insert_at = idx + len("<body>")

    new_html = html[:insert_at] + "\n" + GUARD + html[insert_at:]
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_html)
    print(f"  guard injected into {path} ({len(GUARD)} chars)")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: inject-guard.py /path/to/index.html", file=sys.stderr)
        sys.exit(2)
    sys.exit(inject(sys.argv[1]))
