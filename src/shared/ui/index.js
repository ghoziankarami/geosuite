function initTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem('orebit-theme') || localStorage.getItem('theme') || 'light'; } catch(e) {}
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.body.classList.add('dark');
  }
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
                 document.body.classList.contains('dark');
  // Support both mechanisms (P1 uses data-theme, P2/P3 use body class)
  document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  document.body.classList.toggle('dark', !isDark);
  try { localStorage.setItem('orebit-theme', isDark ? 'light' : 'dark'); } catch(e) {}
  if (typeof window.__onThemeChange === 'function') {
    try { window.__onThemeChange(); } catch(e) { console.warn('[Orebit] Theme change callback error:', e); }
  }
}

// `action` is optional: {label, onClick}. Added 2026-09-08 for Resource's
// export-preflight toasts ("No block grid yet. Run Tab 5 first.") — plain
// text that named a tab and gave no way to get there, same dead end the
// Validation panel had before a click-through existed for it. A toast auto-
// dismisses, so the button gets a longer window (6s vs 3s) to be clicked.
function toast(msg, kind = 'info', action) {
  const div = document.createElement('div');
  const colors = { info: 'var(--info)', good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' };
  div.className = 'toast toast-' + kind;
  div.setAttribute('role', 'status');
  div.style.cssText = `position:fixed;bottom:16px;right:16px;background:${colors[kind] || '#0f172a'};color:white;padding:12px 16px;border-radius:8px;z-index:9999;font-size:13px;font-weight:500;box-shadow:0 20px 25px -5px rgba(15,23,42,0.18),0 8px 10px -6px rgba(15,23,42,0.08);max-width:min(420px,calc(100vw - 32px));animation:toastSlide 200ms cubic-bezier(0.16,1,0.3,1);`;
  if (action && action.label && typeof action.onClick === 'function') {
    const span = document.createElement('span');
    span.textContent = msg;
    div.appendChild(span);
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.style.cssText = 'display:block;margin-top:8px;background:rgba(255,255,255,0.18);color:white;border:1px solid rgba(255,255,255,0.4);border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer;';
    btn.onclick = () => { action.onClick(); div.remove(); };
    div.appendChild(btn);
  } else {
    div.textContent = msg;
  }
  document.body.appendChild(div);
  const dismissDelay = action ? 6000 : 3000;
  setTimeout(() => { div.style.transition='opacity 200ms,transform 200ms'; div.style.opacity='0'; div.style.transform='translateY(8px)'; }, dismissDelay - 300);
  setTimeout(() => div.remove(), dismissDelay);
}

function trapFocus(container) {
  releaseFocus(); // release any previous trap
  _focusTrapContainer = container;
  const focusable = container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  _focusTrapHandler = function(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  container.addEventListener('keydown', _focusTrapHandler);
  setTimeout(() => first.focus(), 50);
}

function releaseFocus() {
  if (_focusTrapHandler && _focusTrapContainer) {
    _focusTrapContainer.removeEventListener('keydown', _focusTrapHandler);
    _focusTrapHandler = null;
    _focusTrapContainer = null;
  }
}

function openHelp() {
  const ov = document.getElementById('helpOverlay');
  if (ov) { ov.classList.add('open'); trapFocus(ov); }
}

function closeHelp() {
  const ov = document.getElementById('helpOverlay');
  if (ov) { ov.classList.remove('open'); releaseFocus(ov); }
}

function openGlossary() {
  renderGlossaryList('');
  const ov = document.getElementById('glossaryOverlay');
  if (ov) { ov.classList.add('open'); trapFocus(ov); }
}

function closeGlossary() {
  const ov = document.getElementById('glossaryOverlay');
  if (ov) { ov.classList.remove('open'); releaseFocus(ov); }
  const i = document.getElementById('glossarySearch'); if (i) i.value = '';
}

function filterGlossary(q) { renderGlossaryList(q || ''); }

function startTour() {
  _tourIdx = 0;
  window._tourActive = true;
  if (typeof showTab === 'function') showTab(1);
  setTimeout(() => _tourRender(), 200);
  localStorage.setItem('orebit-tour-seen-' + (window.__tourPhaseId || 'x'), '1');
}

function _tourRender() {
  const step = window.TOUR_STEPS[_tourIdx];
  if (!step) return;
  const total = window.TOUR_STEPS.length;
  const overlay = document.getElementById('tourOverlay');
  const card = document.getElementById('tourCard');
  const spot = document.getElementById('tourSpotlight');
  overlay.classList.add('open');
  const stepLabel = (window.__t ? window.__t('tour.stepInfo') : 'Step {n} of {total}')
    .replace('{n}', _tourIdx + 1).replace('{total}', total);
  document.getElementById('tourStepInfo').textContent = stepLabel;
  const titleText = step.titleKey && window.__t ? window.__t(step.titleKey) : (step.title || '');
  const bodyText  = step.bodyKey  && window.__t ? window.__t(step.bodyKey)  : (step.body  || '');
  document.getElementById('tourTitle').innerHTML = titleText;
  document.getElementById('tourBody').innerHTML  = bodyText;
  document.getElementById('tourPrev').textContent = (window.__t ? window.__t('tour.prev') : '\u2190 Prev');
  document.getElementById('tourPrev').style.display = _tourIdx > 0 ? '' : 'none';
  document.getElementById('tourNext').textContent = (_tourIdx === total - 1)
    ? (window.__t ? window.__t('tour.done') : 'Done \u2713')
    : (window.__t ? window.__t('tour.next') : 'Next \u2192');
  card.style.display = '';

  // Position card + spotlight
  let target = null;
  if (step.target) {
    // Prefer the shell's visibility-aware resolver (v194_shell.js). The plain
    // lookup below returns hidden elements too, and a hidden element's rect is
    // 0x0 at the origin -- so on mobile, where nav.tabs is display:none and the
    // tabs sit behind the bottom-nav groups, every tab step drew its spotlight
    // as an invisible dot in the top-left corner. Measured 2026-09-04: all
    // targeted steps in all three phases resolved yet none were visible at
    // 375px. The resolver returns the element only if it is really visible,
    // substitutes the bottom-nav group button for a tab hidden behind it, and
    // otherwise returns null -- which the `else` branch below already handles
    // by centring the card with no spotlight.
    target = (typeof window.__orebitTourTarget === 'function')
      ? window.__orebitTourTarget(step.target)
      : ((step.target.startsWith('.') || step.target.includes(' '))
          ? document.querySelector(step.target)
          : document.getElementById(step.target));
  }
  if (target) {
    const r = target.getBoundingClientRect();
    spot.style.display = 'block';
    spot.style.top = (r.top - 4) + 'px';
    spot.style.left = (r.left - 4) + 'px';
    spot.style.width = (r.width + 8) + 'px';
    spot.style.height = (r.height + 8) + 'px';
    const cardW = 380, cardH = 220;
    let top = r.bottom + 14;
    let left = Math.max(20, Math.min(window.innerWidth - cardW - 20, r.left));
    if (top + cardH > window.innerHeight - 20) top = Math.max(20, r.top - cardH - 14);
    card.style.top = top + 'px';
    card.style.left = left + 'px';
  } else {
    spot.style.display = 'none';
    card.style.top = (window.innerHeight / 2 - 120) + 'px';
    card.style.left = (window.innerWidth / 2 - 190) + 'px';
  }
}

function tourNext() {
  if (_tourIdx < window.TOUR_STEPS.length - 1) { _tourIdx++; _tourRender(); }
  else tourSkip();
}

function tourPrev() { if (_tourIdx > 0) { _tourIdx--; _tourRender(); } }

function tourSkip() {
  window._tourActive = false;
  document.getElementById('tourOverlay').classList.remove('open');
  document.getElementById('tourCard').style.display = 'none';
  document.getElementById('tourSpotlight').style.display = 'none';
  localStorage.setItem('orebit-tour-seen-' + (window.__tourPhaseId || 'x'), '1');
}

function _activateTab(n) {
  document.querySelectorAll('nav.tabs .tab').forEach((b, i) => {
    b.classList.toggle('active', i === n - 1);
    b.setAttribute('aria-selected', i === n - 1 ? 'true' : 'false');
  });
  document.querySelectorAll('.panel').forEach((p, i) => {
    p.classList.toggle('active', i === n - 1);
  });
  try { _injectTabHelp(n); } catch (e) { /* non-fatal */ }
  try { _collapseTabHelpOnTouch(); } catch (e) { /* non-fatal */ }
}

// Fold the per-tab help box down to its title on touch devices, measured
// 2026-09-05 at 104px / 16.5% of the distance to the first data row on a
// 375px Collar tab (docs/PLAN-uiux-2.2-2.5.md §3.2). `_injectTabHelp(n)`
// rebuilds `.tab-help` as a plain <div><strong>/<span></div> on every tab
// switch AND every language switch (it always removes the old node first),
// so this cannot be a one-time page-load transform -- it has to re-run after
// every call to _injectTabHelp, which is why it lives right next to that
// call here and in i18n/index.js's applyLanguage, not in a DOMContentLoaded
// listener. Desktop is untouched: gated on pointer:coarse, not on width, per
// the same reasoning as v194_shell.css's touch-target block -- a narrow
// desktop window is not a finger.
function _collapseTabHelpOnTouch() {
  if (!window.matchMedia || !window.matchMedia('(pointer:coarse)').matches) return;
  const box = document.querySelector('.panel.active > .tab-help[data-auto="1"]');
  if (!box || box.tagName === 'DETAILS') return;
  const title = box.querySelector('strong');
  const body = box.querySelector('span');
  if (!title || !body) return; // no description to hide -- nothing to collapse
  const details = document.createElement('details');
  details.className = box.className;
  details.setAttribute('data-auto', '1');
  const summary = document.createElement('summary');
  summary.appendChild(title);
  details.appendChild(summary);
  details.appendChild(body);
  box.replaceWith(details);
}

function dismissDemoBanner() {
  localStorage.setItem('orebit-demo-dismissed', '1');
  refreshDemoBanner();
}

function refreshDemoBanner() {
  // One always-present line naming the data on screen, replacing the
  // dismissable SAMPLE DATA warning that preceded it (2026-09-06).
  //
  // Two problems with the old one. It could be dismissed permanently, and the
  // flag had no expiry or version key — so the strip that existed to stop a
  // screenshot or an exported report being mistaken for real work was one
  // click away from never appearing again, on a shared laptop included. And it
  // said nothing at all when you WERE on your own data, so "which dataset is
  // this?" stayed unanswered in the case where the answer matters most.
  //
  // So: not dismissable, one line, and it always states the source. Sample,
  // your own import, or a restored project each get their own reading. The
  // per-table detail on a partial import is deliberate — loading three of four
  // CSVs and leaving Geology on the built-in example is exactly the state that
  // produced the original confusion.
  const bar = document.getElementById('dataSourceBar');
  if (!bar) return;
  const txt = document.getElementById('dataSourceText');
  const isSample = (typeof window.__isSampleData === 'function')
    ? window.__isSampleData() : false;

  // Phases expose different truths; use what each actually records rather than
  // inventing a filename none of them store.
  let project = null;
  try { project = (typeof STATE !== 'undefined' && STATE.currentProjectName) || null; } catch (e) {}
  if (!project) {
    try {
      const n = (typeof DATA !== 'undefined' && DATA.name) || null;
      if (n && !/sample|thalanga|embedded/i.test(String(n))) project = n;
    } catch (e) {}
  }

  // Core tracks sample-vs-yours per table, which is the only place a partial
  // import can be described honestly.
  let mixed = null;
  try {
    if (typeof STATE !== 'undefined' && STATE.isSample) {
      const names = Object.keys(STATE.isSample);
      // A table the upload emptied (no file given for it) is not "still
      // built-in" -- it holds nothing. Babbitt has no geology file; the bar
      // used to read "Partly sample data -- still built-in: geology".
      const still = names.filter(k => STATE.isSample[k] && !(Array.isArray(STATE[k]) && STATE[k].length === 0));
      if (still.length && still.length < names.length) {
        mixed = { still, total: names.length };
      }
    }
  } catch (e) {}

  const T = (k, fallback) => (typeof t === 'function' ? t(k) : null) || fallback;
  let kind, label, asHtml = false;
  if (mixed) {
    kind = 'warn';
    label = T('ds.mixed', 'Partly sample data — still built-in: {tables}')
      .replace('{tables}', mixed.still.join(', '));
  } else if (isSample) {
    kind = 'warn';
    // The only branch with a link, and the only one rendered as HTML: the
    // string is a static translation with no interpolated value, unlike
    // ds.project below whose {name} comes from user-controlled project/file
    // naming and must stay text-only.
    asHtml = true;
    label = T('ds.sample', 'Sample data — a built-in example, not your data. <a href="#" data-goto-tab="2">Import your own →</a>');
  } else if (project) {
    kind = 'ok';
    label = T('ds.project', 'Your data — project "{name}"').replace('{name}', project);
  } else {
    kind = 'ok';
    label = T('ds.own', 'Your data — imported this session');
  }

  bar.className = 'data-source-bar ' + kind;
  if (txt) { if (asHtml) txt.innerHTML = label; else txt.textContent = label; }
  bar.style.display = '';
}

// ── "How to read this" links into the embedded documentation ────────────────
// Long interpretive help used to sit inline under each plot and panel — up to
// 73 words for a single chart. The same material, in more depth, is already in
// the docs that help_panel.js embeds (they are generated from one source by
// sites/geosuite.orebit.id/docs/docs-tool.py, so the app and the website cannot
// drift). Measured 2026-09-06: ~19 such blocks carried ~600 words between the
// three phases.
//
// So the captions keep one sentence saying what the plot IS, and link the
// "how do I read it / what does good look like" half to the matching docs page.
// The panel is embedded, not fetched, so this still works with no connection —
// which is why these are not plain links to geosuite.orebit.id/docs.
//
// The anchor lives inside the translated string (rendered via innerHTML, same
// as the Lucide icons already embedded in panel titles). One delegated listener
// handles every one of them, so no locale string ever carries inline JS.
document.addEventListener('click', function (e) {
  const a = e.target.closest && e.target.closest('a[data-docs]');
  if (!a) return;
  e.preventDefault();
  const route = a.getAttribute('data-docs');
  // Optional row to land on. ref/plots is one page covering every chart in all
  // three modules, so without this a caption drops the reader at the top of it
  // and leaves them hunting for their own plot.
  const find = a.getAttribute('data-docs-find');
  if (window.OrebitHelp && typeof window.OrebitHelp.open === 'function') {
    window.OrebitHelp.open(route, null, find);
  } else if (typeof toast === 'function') {
    // help_panel.js is injected by the build's patcher. If someone opens a raw
    // phase file straight from exe-wrapper/pywebview/phases/ it will be absent;
    // say so rather than dead-clicking.
    toast(typeof t === 'function' ? t('docs.unavailable') : 'Documentation panel unavailable.', 'warn');
  }
});

// "Import your own →" inside the sample-data banner — same-page tab switch,
// not a docs route, so it gets its own attribute rather than overloading
// data-docs. Tab index is 2 in all three phases (Core's Import tab, Assay's
// and Resource's Upload tab), matching the onboarding "Open Import" button
// already hardcoding the same index elsewhere in these phases.
document.addEventListener('click', function (e) {
  const a = e.target.closest && e.target.closest('a[data-goto-tab]');
  if (!a) return;
  e.preventDefault();
  const idx = parseInt(a.getAttribute('data-goto-tab'), 10);
  if (typeof showTab === 'function' && !isNaN(idx)) showTab(idx);
});

// Exposed so applyLanguage() can re-render this line on a language switch.
window.refreshDemoBanner = refreshDemoBanner;
