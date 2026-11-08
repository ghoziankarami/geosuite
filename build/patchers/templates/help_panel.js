<script id="obh-script">
/* ===================================================================
   Orebit in-app documentation panel
   -------------------------------------------------------------------
   Content is the SAME data that builds geosuite.orebit.id/docs — it is
   exported by sites/geosuite.orebit.id/docs/docs-tool.py and embedded
   below. Nothing here is authored by hand, so the app and the website
   cannot drift apart.

   Integration notes:
   - Entry point is the app's OWN per-tab "Help & Technical Reference" modal
     (.help-modal, opened from the visible .tab-help control). This script
     adds one call to action inside it rather than introducing a second
     button called Help. The two layer: the modal stays the short note about
     the current tab, the panel is the full manual.
     Measured 2026-08-22: the v194 floating "?" bubble is present in the DOM
     but renders hidden in current builds, so it cannot be the only route in;
     it is still wired up opportunistically, and a header button is added
     only if neither surface exists.
   - Language follows the host app: it reads documentElement.lang and
     re-renders when the app's language switch changes it.
   - Everything is wrapped so a failure here can never break the app.
=================================================================== */
(function () {
  'use strict';
  if (window.__OREBIT_HELP_PANEL__) return;   // idempotent re-injection
  window.__OREBIT_HELP_PANEL__ = true;

  var DATA = __OB_HELP_DATA__;
  var TABMAP = __OB_TAB_MAP__;
  var PHASE = '__OB_PHASE__';
  var DOCS_URL = '__OB_DOCS_URL__';

  /* ---------------- i18n ---------------- */
  function isID() {
    try { return document.documentElement.lang === 'id'; } catch (e) { return false; }
  }
  function tx(n) {
    if (n == null) return '';
    if (typeof n === 'string') return n;
    return (isID() ? (n.id != null ? n.id : n.en) : n.en) || '';
  }
  function ttl(o) { return isID() ? (o.id_ || o.en) : o.en; }
  var STR = {
    title:   { en: 'Documentation',        id: 'Dokumentasi' },
    search:  { en: 'Search all help…',     id: 'Cari seluruh bantuan…' },
    ctx:     { en: 'For this tab',         id: 'Untuk tab ini' },
    browse:  { en: 'Browse',               id: 'Jelajahi' },
    none:    { en: 'Nothing found.',       id: 'Tidak ditemukan.' },
    back:    { en: 'Back',                 id: 'Kembali' },
    open:    { en: 'Open full docs',       id: 'Buka dokumentasi lengkap' },
    menu:    { en: 'Search documentation', id: 'Cari dokumentasi' },
    close:   { en: 'Close',                id: 'Tutup' },
    ktoggle: { en: 'toggle',               id: 'buka/tutup' },
    note:    { en: 'Note',                 id: 'Catatan' },
    warn:    { en: 'Careful',              id: 'Perhatian' },
    bad:     { en: 'Do not',               id: 'Jangan' },
    good:    { en: 'Good practice',        id: 'Praktik baik' },
    verify:  { en: 'Needs verification',   id: 'Perlu verifikasi' }
  };
  function S(k) { return tx(STR[k]); }

  /* ---------------- flatten ---------------- */
  var FLAT = [];
  DATA.d.forEach(function (sec) {
    sec.pages.forEach(function (pg) {
      FLAT.push({ sec: sec, page: pg, route: sec.id + '/' + pg.id });
    });
  });
  function byRoute(r) {
    for (var i = 0; i < FLAT.length; i++) if (FLAT[i].route === r) return FLAT[i];
    return null;
  }

  /* ---------------- which tab is the user on? ---------------- */
  // Tabs are rendered as <button class="tab" onclick="showTab(N)">; the active
  // one carries .active. Index among .tab elements matches N.
  function curTab() {
    try {
      var tabs = document.querySelectorAll('.tab');
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].classList.contains('active')) return i + 1;
      }
    } catch (e) {}
    return 0;
  }
  function curTabName() {
    try {
      var tabs = document.querySelectorAll('.tab');
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].classList.contains('active')) {
          return (tabs[i].textContent || '').trim().split('\n')[0].slice(0, 24);
        }
      }
    } catch (e) {}
    return '';
  }
  function ctxEntries() {
    var m = (TABMAP[String(curTab())] || []);
    var out = [];
    m.forEach(function (spec) {
      var parts = String(spec).split('#');
      var e = byRoute(parts[0]);
      if (e) out.push({ entry: e, symptom: parts[1] || null });
    });
    return out;
  }

  /* ---------------- text extraction (search index) ---------------- */
  function textOf(blocks, acc) {
    blocks.forEach(function (b) {
      if (b.t === 'p' || b.t === 'h' || b.t === 'note') acc.push(tx(b));
      else if (b.t === 'ul' || b.t === 'steps') b.items.forEach(function (i) { acc.push(tx(i)); });
      else if (b.t === 'table') {
        b.head.forEach(function (h) { acc.push(tx(h)); });
        b.rows.forEach(function (r) { r.forEach(function (c) { acc.push(tx(c)); }); });
      } else if (b.t === 'cards') {
        b.items.forEach(function (c) {
          acc.push(tx({ en: c.en, id: c.id })); acc.push(tx({ en: c.den, id: c.did }));
        });
      } else if (b.t === 'sx') {
        b.items.forEach(function (s) { acc.push(tx(s.q)); textOf(s.a, acc); });
      }
    });
    return acc;
  }
  var INDEX = [];
  function buildIndex() {
    INDEX = FLAT.map(function (e) {
      var acc = [ttl(e.page), e.page.lede ? tx(e.page.lede) : ''];
      textOf(e.page.blocks, acc);
      return {
        e: e,
        title: ttl(e.page),
        sec: ttl(e.sec),
        text: acc.join(' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      };
    });
    // Troubleshooting symptoms are indexed individually — a user searching
    // "flat variogram" wants the symptom, not the page that contains it.
    FLAT.forEach(function (e) {
      e.page.blocks.forEach(function (b) {
        if (b.t !== 'sx') return;
        b.items.forEach(function (s) {
          INDEX.push({
            e: e, symptom: s.key || null,
            title: tx(s.q), sec: ttl(e.sec),
            text: (tx(s.q) + ' ' + textOf(s.a, []).join(' '))
              .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
          });
        });
      });
    });
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function mark(s, terms) {
    var o = esc(s);
    terms.forEach(function (t) {
      if (!t) return;
      o = o.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
    });
    return o;
  }
  function search(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    var terms = q.split(/\s+/);
    return INDEX.map(function (d) {
      var hay = d.text.toLowerCase(), score = 0, ok = true;
      terms.forEach(function (t) {
        var n = hay.split(t).length - 1;
        if (!n) { ok = false; return; }
        score += n;
        if (d.title.toLowerCase().indexOf(t) >= 0) score += 45;
        if (d.symptom) score += 8;          // symptoms are usually the answer
      });
      if (!ok) return null;
      var i = d.text.toLowerCase().indexOf(terms[0]);
      var st = Math.max(0, i - 40);
      return { d: d, score: score, snip: (st ? '…' : '') + d.text.slice(st, st + 120) + '…' };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, 14);
  }

  /* ---------------- block rendering ---------------- */
  function blk(b) {
    switch (b.t) {
      case 'p': return '<p>' + tx(b) + '</p>';
      case 'h': return '<h3>' + tx(b) + '</h3>';
      case 'note':
        return '<div class="obh-note ' + (b.k || 'info') + '"><b>' + S(b.k || 'note') + '</b>' + tx(b) + '</div>';
      case 'ul':
        return '<ul>' + b.items.map(function (i) { return '<li>' + tx(i) + '</li>'; }).join('') + '</ul>';
      case 'steps':
        return '<ol class="obh-steps">' + b.items.map(function (i) { return '<li>' + tx(i) + '</li>'; }).join('') + '</ol>';
      case 'table':
        return '<div class="obh-tw"><table><thead><tr>'
          + b.head.map(function (h) { return '<th>' + tx(h) + '</th>'; }).join('')
          + '</tr></thead><tbody>'
          + b.rows.map(function (r) {
              return '<tr>' + r.map(function (c) { return '<td>' + tx(c) + '</td>'; }).join('') + '</tr>';
            }).join('')
          + '</tbody></table></div>';
      case 'cards':
        return b.items.map(function (c) {
          return '<button class="obh-item" data-go="' + c.to + '"><b>'
            + ttl({ en: c.en, id_: c.id }) + '</b><span>' + tx({ en: c.den, id: c.did }) + '</span></button>';
        }).join('');
      case 'sx':
        return b.items.map(function (s) {
          return '<details class="obh-sx" data-key="' + (s.key || '') + '"><summary>' + tx(s.q)
            + '</summary><div class="obh-sxb">' + s.a.map(blk).join('') + '</div></details>';
        }).join('');
      default: return '';
    }
  }

  /* ---------------- DOM ---------------- */
  var scrim, panel, input, body, ctxPill, view = { route: null, symptom: null, find: null };

  function build() {
    scrim = document.createElement('div');
    scrim.className = 'obh-scrim';

    panel = document.createElement('aside');
    panel.className = 'obh-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Documentation');
    panel.innerHTML =
      '<div class="obh-head"><b class="obh-t"></b><span class="obh-ctx"></span>'
      + '<button class="obh-x" type="button" aria-label="Close">&times;</button></div>'
      + '<div class="obh-searchwrap"><input class="obh-search" type="search" autocomplete="off" spellcheck="false"></div>'
      + '<div class="obh-body"></div>'
      + '<div class="obh-foot"><span><span class="obh-kbd">F1</span> '
      + '<span class="obh-fk"></span> · <span class="obh-kbd">Esc</span></span>'
      + '<a class="obh-full" href="' + DOCS_URL + '" target="_blank" rel="noopener"></a></div>';

    document.body.appendChild(scrim);
    document.body.appendChild(panel);

    input = panel.querySelector('.obh-search');
    body = panel.querySelector('.obh-body');
    ctxPill = panel.querySelector('.obh-ctx');

    panel.querySelector('.obh-x').addEventListener('click', close);
    scrim.addEventListener('click', close);
    input.addEventListener('input', function () { render(); });

    body.addEventListener('click', function (ev) {
      var go = ev.target.closest('[data-go]');
      if (go) { view = { route: go.getAttribute('data-go'), symptom: go.getAttribute('data-sym'), find: null }; input.value = ''; render(); return; }
      var back = ev.target.closest('.obh-back');
      if (back) { view = { route: null, symptom: null, find: null }; render(); }
    });
  }

  function paintChrome() {
    panel.querySelector('.obh-t').textContent = S('title');
    panel.querySelector('.obh-full').textContent = S('open');
    panel.querySelector('.obh-fk').textContent = S('ktoggle');
    input.placeholder = S('search');
    var n = curTabName();
    ctxPill.textContent = n || PHASE;
    ctxPill.style.display = n ? '' : 'none';
  }

  function render() {
    paintChrome();
    var q = input.value.trim();

    if (q) {                                        // ---- search results
      var res = search(q);
      if (!res.length) { body.innerHTML = '<div class="obh-empty">' + S('none') + '</div>'; return; }
      var terms = q.toLowerCase().split(/\s+/);
      body.innerHTML = '<div class="obh-lbl">' + res.length + '</div>' + res.map(function (r) {
        return '<button class="obh-item" data-go="' + r.d.e.route + '"'
          + (r.d.symptom ? ' data-sym="' + r.d.symptom + '"' : '') + '>'
          + '<i>' + esc(r.d.sec) + '</i><b>' + mark(r.d.title, terms) + '</b>'
          + '<span>' + mark(r.snip, terms) + '</span></button>';
      }).join('');
      return;
    }

    if (view.route) {                               // ---- one article
      var e = byRoute(view.route);
      if (!e) { view = { route: null, symptom: null, find: null }; return render(); }
      // Back control and title live in one sticky bar. On a long reference page
      // — or after a deep-link scrolls you into the middle of one — a back
      // button pinned to the top of the document would be off screen, leaving
      // the reader stranded with no way out but the keyboard.
      body.innerHTML =
        '<div class="obh-artbar">'
        + '<button class="obh-back" type="button" aria-label="' + esc(S('back')) + '">&larr;</button>'
        + '<span class="obh-artttl">' + esc(ttl(e.page)) + '</span>'
        + '<em>' + esc(ttl(e.sec)) + '</em></div>'
        + '<div class="obh-art">'
        + (e.page.lede ? '<div class="obh-lede">' + tx(e.page.lede) + '</div>' : '')
        + e.page.blocks.map(blk).join('') + '</div>';
      if (view.symptom) {
        var d = body.querySelector('details.obh-sx[data-key="' + view.symptom + '"]');
        if (d) { d.open = true; setTimeout(function () { d.scrollIntoView({ block: 'start' }); }, 30); }
      }
      // Deep-link into a long reference page. ref/plots documents every chart
      // in all three modules on one page, so a caption linking to it landed the
      // reader at the top of ~11,500 characters and left them to find their own
      // plot — reported 2026-09-07 from Core's Section caption. There is no id
      // to anchor to (the content is a table), so match on the row label the
      // docs already use, e.g. "Section (9)".
      if (view.find) {
        var needle = String(view.find).toLowerCase();
        var hit = null;
        var cells = body.querySelectorAll('.obh-art td, .obh-art th, .obh-art h3, .obh-art h4, .obh-art li');
        for (var i = 0; i < cells.length; i++) {
          if ((cells[i].textContent || '').toLowerCase().indexOf(needle) !== -1) { hit = cells[i]; break; }
        }
        if (hit) {
          var target = hit.closest('tr') || hit;
          target.classList.add('obh-found');
          setTimeout(function () { target.scrollIntoView({ block: 'center' }); }, 30);
          return;
        }
      }
      body.scrollTop = view.symptom ? body.scrollTop : 0;
      return;
    }

    // ---- default: context for this tab, then everything else
    var html = '';
    var ctx = ctxEntries();
    if (ctx.length) {
      html += '<div class="obh-lbl">' + S('ctx') + '</div>';
      html += ctx.map(function (c) {
        var label = c.symptom ? symptomTitle(c.entry, c.symptom) : ttl(c.entry.page);
        return '<button class="obh-item" data-go="' + c.entry.route + '"'
          + (c.symptom ? ' data-sym="' + c.symptom + '"' : '') + '>'
          + '<i>' + esc(ttl(c.entry.sec)) + '</i><b>' + esc(label) + '</b></button>';
      }).join('');
    }
    // Sections collapse. Listing all 24 pages flat buried the contextual
    // entries above under a long scroll; only the first section starts open.
    html += '<div class="obh-lbl">' + S('browse') + '</div>';
    DATA.d.forEach(function (sec, i) {
      html += '<details class="obh-sec"' + (i === 0 ? ' open' : '') + '>'
        + '<summary>' + esc(ttl(sec)) + '<span>' + sec.pages.length + '</span></summary>';
      sec.pages.forEach(function (pg) {
        html += '<button class="obh-item" data-go="' + sec.id + '/' + pg.id + '"><b>'
          + esc(ttl(pg)) + '</b></button>';
      });
      html += '</details>';
    });
    body.innerHTML = html;
    body.scrollTop = 0;
  }

  function symptomTitle(entry, key) {
    var found = '';
    entry.page.blocks.forEach(function (b) {
      if (b.t !== 'sx') return;
      b.items.forEach(function (s) { if (s.key === key) found = tx(s.q); });
    });
    return found || ttl(entry.page);
  }

  /* ---------------- open / close ---------------- */
  function open(route, symptom, find) {
    if (!panel) build();
    buildIndex();
    view = { route: route || null, symptom: symptom || null, find: find || null };
    if (input) input.value = '';
    render();
    scrim.classList.add('obh-on');
    panel.classList.add('obh-on');
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 180);
  }
  function close() {
    if (!panel) return;
    scrim.classList.remove('obh-on');
    panel.classList.remove('obh-on');
  }
  function isOpen() { return panel && panel.classList.contains('obh-on'); }

  /* ---------------- triggers ---------------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'F1') { e.preventDefault(); isOpen() ? close() : open(); }
    else if (e.key === 'Escape' && isOpen()) { e.preventDefault(); close(); }
  });

  // Entry point. The app already ships a per-tab "Help & Technical Reference"
  // modal, reached from a visible .tab-help control — so adding another help
  // button would give the user two things called Help. Instead the two are
  // layered: the modal stays the short note about the tab you are on, and it
  // gains one call to action that opens this panel for the full documentation.
  // (The v194 floating bubble is handled too, but it renders hidden in current
  // builds, so it cannot be the only route in.)
  function ctaLabel() {
    return (isID() ? 'Cari dokumentasi lengkap' : 'Search the full documentation') + ' →';
  }
  function ensureModalCta() {
    var modal = document.querySelector('.help-modal');
    if (!modal) return false;
    var existing = modal.querySelector('.obh-cta');
    if (existing) {
      // Write only on a real change. This function is also called FROM a
      // MutationObserver on this modal, so an unconditional textContent write
      // would retrigger the observer, which would write again — an infinite
      // mutation loop that hangs the page before DOMContentLoaded fires.
      var want = ctaLabel();
      if (existing.textContent !== want) existing.textContent = want;
      return true;
    }
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'obh-cta';
    b.textContent = ctaLabel();
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      // Close the host modal first so the two never overlap.
      try {
        if (typeof window.closeHelp === 'function') window.closeHelp();
        else modal.style.display = 'none';
      } catch (e) {}
      open();
    });
    // Sits directly under the modal heading, before the body content.
    var h = modal.querySelector('h2, h3, .help-title');
    if (h && h.parentNode) h.parentNode.insertBefore(b, h.nextSibling);
    else modal.insertBefore(b, modal.firstChild);
    return true;
  }

  function attachToBubbleMenu() {
    var menu = document.querySelector('.orebit-help-menu');
    if (!menu || menu.querySelector('[data-action="obh-docs"]')) return !!menu;
    var b = document.createElement('button');
    b.setAttribute('data-action', 'obh-docs');
    b.innerHTML = '<span class="icon">📖</span><span class="label"></span>';
    b.querySelector('.label').textContent = S('menu');
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      menu.classList.remove('open', 'show', 'visible');
      menu.style.display = '';
      open();
    });
    menu.insertBefore(b, menu.firstChild);
    return true;
  }

  // Last resort only: if the app exposes neither help surface, put a button in
  // the header so the documentation is never unreachable.
  function attachHeaderButton() {
    if (document.querySelector('.obh-btn')) return;
    var anchor = document.getElementById('lang-switch');
    if (!anchor || !anchor.parentNode) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'obh-btn';
    b.textContent = '?';
    b.title = S('menu');
    b.setAttribute('aria-label', S('menu'));
    b.addEventListener('click', function () { open(); });
    anchor.parentNode.insertBefore(b, anchor);
  }

  // The header already carries a "Documentation" link pointing at the website.
  // That is where a user looks for documentation, so it opens the panel instead
  // — the answer arrives in place rather than in a new tab, and offline too.
  // Ctrl/Cmd/middle click still reaches the website for anyone who wants it.
  function claimHeaderDocsLink() {
    var a = document.querySelector('a[href*="/docs"]');
    if (!a || a.getAttribute('data-obh-claimed')) return !!a;
    a.setAttribute('data-obh-claimed', '1');
    a.addEventListener('click', function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
      ev.preventDefault();
      open();
    });
    return true;
  }

  function wireEntryPoints() {
    var got = ensureModalCta();
    if (attachToBubbleMenu()) got = true;
    if (claimHeaderDocsLink()) got = true;
    return got;
  }

  // Wire up as soon as the host has rendered, and keep the CTA alive: the app
  // rebuilds the modal's contents per tab, which would otherwise drop it.
  (function init() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (wireEntryPoints() || tries > 15) {          // ~3 s, then fall back
        clearInterval(timer);
        if (!document.querySelector('.help-modal')
            && !document.querySelector('.orebit-help-menu')) attachHeaderButton();
      }
    }, 200);
    try {
      var modal = document.querySelector('.help-modal');
      if (modal) {
        new MutationObserver(function () { ensureModalCta(); })
          .observe(modal, { childList: true, subtree: true });
      }
    } catch (e) {}
  })();

  // Follow the host app's language switch.
  try {
    new MutationObserver(function () {
      var lbl = document.querySelector('[data-action="obh-docs"] .label');
      if (lbl) lbl.textContent = S('menu');
      ensureModalCta();                    // CTA text is language-dependent too
      if (isOpen()) { buildIndex(); render(); }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  } catch (e) {}

  // Re-render context when the user changes tab while the panel is open.
  document.addEventListener('click', function (e) {
    if (!isOpen()) return;
    if (e.target.closest && e.target.closest('.tab')) {
      setTimeout(function () { if (!input.value && !view.route) render(); else paintChrome(); }, 60);
    }
  }, true);

  window.OrebitHelp = { open: open, close: close, version: DATA.v };
})();
</script>
