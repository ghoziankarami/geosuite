function t(key) {
  const lang = _i18nLang;
  const dict = (window.TR && window.TR[lang]) || (window.TR && window.TR.en) || {};
  if (key in dict) return dict[key];
  return (window.TR && window.TR.en && window.TR.en[key] !== undefined) ? window.TR.en[key] : key;
}

function translateTree(root) {
  if (!root || root.nodeType !== 1) return;
  const apply = (el) => {
    const key = el.getAttribute('data-i18n');
    if (key) { const v = t(key); if (v !== undefined && v !== null && v !== key) el.innerHTML = String(v).replace(/\{version\}/g, window.OREBIT_VERSION || ''); }
    const spec = el.getAttribute('data-i18n-attr');
    if (spec) {
      spec.split(',').forEach(pair => {
        const bits = pair.split(':').map(x => x.trim());
        if (bits[0] && bits[1]) { const v = t(bits[1]); if (v !== undefined && v !== null) el.setAttribute(bits[0], v); }
      });
    }
  };
  if (root.hasAttribute && (root.hasAttribute('data-i18n') || root.hasAttribute('data-i18n-attr'))) apply(root);
  const nodes = root.querySelectorAll ? root.querySelectorAll('[data-i18n],[data-i18n-attr]') : [];
  for (let i = 0; i < nodes.length; i++) apply(nodes[i]);
}

// Unified 2026-09-04 (docs/PLAN-arsitektur-4.2-4.3.md, Tahap 4.3): Core, Assay
// and Resource each carried their own applyLanguage(), byte-different in only
// two respects, both real -- not drift to be papered over:
//
//   1. Resolving "which tab is active" for _injectTabHelp(). Resource tracks
//      a global `currentTab` variable; Core and Assay don't have one and
//      derive the index from the DOM instead. A phase can override
//      window.__i18nActiveTabIndex() to supply its own answer; the DOM
//      lookup below is the default for phases that don't.
//   2. Assay-only post-switch work (glossary tooltips, the data-provenance
//      panel) that Core and Resource have no equivalent of. Rather than
//      name Assay inside shared code, a phase registers its own follow-up
//      work by pushing onto window.__i18nPostApplyHooks; this function
//      itself never checks which phase it is running in.
//
// Everything else here was byte-identical across all three and is now the
// single implementation.
function applyLanguage(lang) {
  // Remember what we were on: the re-render at the tail must only fire on an
  // actual switch, never on the call that runs during boot.
  const _langBefore = _i18nLang;
  if (!window.TR || !window.TR[lang]) lang = 'en';
  _i18nLang = lang;
  try { document.documentElement.setAttribute('lang', lang); } catch (e) {}
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const v = t(key);
    // innerHTML (not textContent): some i18n values embed Lucide SVG icons (e.g. panel titles).
    // Values come from the developer-controlled TR dict, not user input, so this is XSS-safe.
    if (v !== undefined && v !== null) el.innerHTML = String(v).replace(/\{version\}/g, window.OREBIT_VERSION || '');
  });
  // Patcher-injected chrome uses data-orebit-i18n (sidebar section labels, navbar, etc).
  // applyLanguage must re-translate these too, else they stay in English on toggle (pitfall #19).
  document.querySelectorAll('[data-orebit-i18n]').forEach(el => {
    const key = el.getAttribute('data-orebit-i18n');
    if (!key) return;
    const v = t(key);
    if (v !== undefined && v !== null) el.innerHTML = String(v).replace(/\{version\}/g, window.OREBIT_VERSION || '');
  });
  document.querySelectorAll('[data-orebit-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-orebit-i18n-title');
    if (!key) return;
    const v = t(key);
    if (v !== undefined && v !== null) el.setAttribute('title', v);
  });
  document.querySelectorAll('[data-orebit-i18n-aria]').forEach(el => {
    const key = el.getAttribute('data-orebit-i18n-aria');
    if (!key) return;
    const v = t(key);
    if (v !== undefined && v !== null) el.setAttribute('aria-label', v);
  });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    const spec = el.getAttribute('data-i18n-attr');
    if (!spec) return;
    spec.split(',').forEach(pair => {
      const [attr, key] = pair.split(':').map(s => s.trim());
      if (attr && key) {
        const v = t(key);
        if (v !== undefined && v !== null) el.setAttribute(attr, v);
      }
    });
  });
  // Toggle button shows OPPOSITE label (what user will switch to)
  const btn = document.getElementById('lang-switch');
  if (btn) {
    const lbl = btn.querySelector('.lang-label');
    if (lbl) lbl.textContent = (lang === 'en') ? 'ID' : 'EN';
    else btn.textContent = (lang === 'en') ? 'ID' : 'EN';
    btn.setAttribute('aria-label', (lang === 'en') ? 'Beralih ke Bahasa Indonesia' : 'Switch to English');
  }
  // Bottom nav labels are captured at init; re-render them on toggle.
  if (window.__updateMobileNavLabels) { try { window.__updateMobileNavLabels(); } catch (e) {} }
  // Same shape of problem for the data-source bar: its line is composed in JS
  // (it interpolates a project name or the list of tables still on sample
  // data), so it cannot carry a data-i18n key and the walk above skips it.
  // Without this it kept the language it was first rendered in — which is
  // precisely what i18n-coverage.py flagged when the bar landed.
  if (window.refreshDemoBanner) { try { window.refreshDemoBanner(); } catch (e) {} }
  // Re-inject tab-help so it picks up the new language (fix 2026-07-27: was staying EN on ID toggle).
  try {
    if (typeof _injectTabHelp === 'function') {
      let tabNum;
      if (typeof window.__i18nActiveTabIndex === 'function') {
        tabNum = window.__i18nActiveTabIndex();
      } else {
        const activeTab = document.querySelector('nav.tabs .tab.active');
        tabNum = activeTab ? Array.from(document.querySelectorAll('nav.tabs .tab')).indexOf(activeTab) + 1 : 1;
      }
      if (tabNum) _injectTabHelp(tabNum);
    }
  } catch (e) {}
  // _injectTabHelp above just rebuilt .tab-help as a plain div, undoing any
  // touch-collapse from _activateTab -- redo it here too. See
  // _collapseTabHelpOnTouch()'s comment in shared/ui/index.js.
  try {
    if (typeof _collapseTabHelpOnTouch === 'function') _collapseTabHelpOnTouch();
  } catch (e) {}
  // Re-render dynamic tour text if a tour is currently visible
  if (window._tourActive && typeof _tourRender === 'function') {
    try { _tourRender(); } catch (e) {}
  }
  // Phase-specific post-switch work (e.g. Assay's glossary/data-provenance
  // refresh) that this shared function has no business knowing the names of.
  if (Array.isArray(window.__i18nPostApplyHooks)) {
    window.__i18nPostApplyHooks.forEach(fn => { try { fn(lang); } catch (e) {} });
  }
  try { localStorage.setItem('lang', lang); } catch (e) {}
  try { localStorage.setItem('orebit.lang', lang); } catch (e) {}
  // --- Re-render the active tab -------------------------------------------
  // Everything above only rewrites nodes carrying data-i18n. Text that a render
  // function built itself had its language decided when the panel was drawn,
  // so a toggle left those panels in the previous language. showTab()
  // re-reads from STATE and recomputes nothing, so redrawing the current tab
  // is cheap and is the only thing that makes those strings follow the switch.
  // Guarded on an actual change AND on boot being finished, so the language
  // restore during startup does not trigger a render before data exists.
  if (_langBefore !== lang && window.__i18nBooted && typeof showTab === 'function') {
    try {
      const _tabs = Array.from(document.querySelectorAll('nav.tabs .tab'));
      const _idx = _tabs.findIndex(b => b.classList.contains('active'));
      if (_idx >= 0) {
        const _y = window.scrollY;
        showTab(_idx + 1);
        // The V194 header breadcrumb mirrors the active tab's label, but it is
        // only re-synced inside the shell's own setLang(). Anything that calls
        // applyLanguage() directly — the in-app language picker included — left
        // it showing the previous language. Re-sync it from the tab we just
        // re-rendered.
        const _crumb = document.getElementById('orebitCrumb');
        if (_crumb) _crumb.textContent = (_tabs[_idx].textContent || '').trim();
        // Keep the reader where they were; a language toggle should not scroll.
        requestAnimationFrame(() => window.scrollTo(0, _y));
      }
    } catch (e) {
      console.warn('[i18n re-render]', e && e.message);
    }
  }
}
