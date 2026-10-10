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

const _dialogFocusStack = [];
function _visibleFocusTarget(el) {
  return !!el?.isConnected && !el.disabled && !el.closest('[inert]') &&
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}
function _dialogFocusables(container) {
  return Array.from(container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]'
  )).filter(el => el.tabIndex >= 0 && _visibleFocusTarget(el));
}
function _dialogOpener(el) {
  // These menus close before opening their dialog. Return to their visible trigger.
  if (el?.closest('.orebit-help-menu')) return document.querySelector('button.orebit-help-bubble');
  if (el?.closest('.orebit-profile-menu')) return document.querySelector('button.orebit-avatar');
  return el;
}
function trapFocus(container, options = {}) {
  if (_dialogFocusStack.at(-1)?.container === container) releaseFocus(container, false);
  if (_focusTrapHandler && _focusTrapContainer) _focusTrapContainer.removeEventListener('keydown', _focusTrapHandler);
  const entry = {container, opener:_dialogOpener(options.opener || document.activeElement)};
  entry.handler = function(e) {
    if (e.key === 'Escape' && options.close) {
      e.preventDefault(); e.stopPropagation(); options.close(); return;
    }
    if (e.key !== 'Tab') return;
    const controls = _dialogFocusables(container), first = controls[0], last = controls.at(-1);
    if (!first) {e.preventDefault(); return;}
    if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
      e.preventDefault(); first.focus();
    }
  };
  _dialogFocusStack.push(entry);
  _focusTrapContainer = container; _focusTrapHandler = entry.handler;
  container.addEventListener('keydown', entry.handler);
  const first = _visibleFocusTarget(options.initialFocus) ? options.initialFocus : _dialogFocusables(container)[0];
  first?.focus({preventScroll:true});
}

function releaseFocus(container, restore = true) {
  const index = container ? _dialogFocusStack.findIndex(entry => entry.container === container) : _dialogFocusStack.length - 1;
  if (index < 0) return;
  const [entry] = _dialogFocusStack.splice(index, 1);
  entry.container.removeEventListener('keydown', entry.handler);
  if (_focusTrapContainer !== entry.container) return;
  const parent = _dialogFocusStack.at(-1);
  _focusTrapContainer = parent?.container || null; _focusTrapHandler = parent?.handler || null;
  if (parent) parent.container.addEventListener('keydown', parent.handler);
  if (restore) {
    const target = _visibleFocusTarget(entry.opener) && (!parent || parent.container.contains(entry.opener))
      ? entry.opener : parent && _dialogFocusables(parent.container)[0];
    target?.focus({preventScroll:true});
  }
}

// Owners retain their existing close/remove and confirmation callbacks. Observe
// only the overlay's parent so owner refreshes/removals also release the trap.
function openModalDialog(container, options = {}) {
  container.setAttribute('role','dialog'); container.setAttribute('aria-modal','true');
  if (options.labelledby) container.setAttribute('aria-labelledby',options.labelledby);
  else if (options.label) container.setAttribute('aria-label',options.label);
  const overlay = options.overlay || container;
  overlay.__dialogOpener = _dialogOpener(options.opener || document.activeElement);
  const observer = new MutationObserver(() => {
    if (!overlay.isConnected) {observer.disconnect(); releaseFocus(container);}
  });
  observer.observe(overlay.parentNode, {childList:true});
  trapFocus(container, {...options, opener:overlay.__dialogOpener});
}

function openHelp() {
  const ov = document.getElementById('helpOverlay');
  if (ov) { ov.classList.add('open'); trapFocus(ov, {close:closeHelp}); }
}

function closeHelp() {
  const ov = document.getElementById('helpOverlay');
  if (ov) { ov.classList.remove('open'); releaseFocus(ov); }
}

function openGlossary() {
  renderGlossaryList('');
  const ov = document.getElementById('glossaryOverlay');
  if (ov) { ov.classList.add('open'); ov.querySelector('[role="dialog"]').setAttribute('aria-modal','true'); trapFocus(ov, {close:closeGlossary}); }
}

function closeGlossary() {
  const ov = document.getElementById('glossaryOverlay');
  if (ov) { ov.classList.remove('open'); releaseFocus(ov); }
  const i = document.getElementById('glossarySearch'); if (i) i.value = '';
}

function filterGlossary(q) { renderGlossaryList(q || ''); }

let _tourOpener = null;
let _tourReturnTab = 1;
function startTour() {
  if (window._tourActive) return;
  _tourOpener = _dialogOpener(document.activeElement);
  _tourReturnTab = Array.from(document.querySelectorAll('nav.tabs .tab')).findIndex(b=>b.classList.contains('active')) + 1;
  _tourIdx = 0;
  window._tourActive = true;
  _tourRender();
  const card = document.getElementById('tourCard');
  card.setAttribute('aria-modal','true');
  trapFocus(card);
  localStorage.setItem('orebit-tour-seen-' + (window.__tourPhaseId || 'x'), '1');
}

function _tourPosition() {
  if (!window._tourActive) return;
  const step = window.TOUR_STEPS[_tourIdx], card=document.getElementById('tourCard'), spot=document.getElementById('tourSpotlight');
  const target=step.target ? document.querySelector(step.target) : null;
  let rect=target?.getBoundingClientRect();
  if(rect && (!rect.width || !rect.height || rect.top<0 || rect.bottom>innerHeight || rect.left<0 || rect.right>innerWidth)) rect=null;
  const width=card.getBoundingClientRect().width, height=card.getBoundingClientRect().height, gap=12;
  let left=(innerWidth-width)/2, top=(innerHeight-height)/2;
  if(rect){
    left=rect.left;
    if(rect.bottom+gap+height<=innerHeight-gap)top=rect.bottom+gap;
    else if(rect.top-gap-height>=gap)top=rect.top-gap-height;
    spot.style.cssText=`display:block;top:${Math.max(0,rect.top-4)}px;left:${Math.max(0,rect.left-4)}px;width:${Math.min(innerWidth,rect.width+8)}px;height:${rect.height+8}px`;
  } else spot.style.display='none';
  card.style.left=Math.max(gap,Math.min(innerWidth-width-gap,left))+'px';
  card.style.top=Math.max(gap,Math.min(innerHeight-height-gap,top))+'px';
}
function _tourRender() {
  if (!window._tourActive) return;
  const step = window.TOUR_STEPS[_tourIdx];
  if (!step) return;
  const active=Array.from(document.querySelectorAll('nav.tabs .tab')).findIndex(b=>b.classList.contains('active'))+1;
  // Tour visits visible controls only. It never clicks Apply, Compute or Review.
  if(step.tab && active!==step.tab && typeof showTab==='function')showTab(step.tab);
  const card=document.getElementById('tourCard');
  document.getElementById('tourOverlay').classList.add('open');
  document.getElementById('tourStepInfo').textContent=window.__t('tour.stepInfo').replace('{n}',_tourIdx+1).replace('{total}',window.TOUR_STEPS.length);
  document.getElementById('tourTitle').textContent=step.titleKey?window.__t(step.titleKey):step.title;
  document.getElementById('tourBody').textContent=step.bodyKey?window.__t(step.bodyKey):step.body;
  document.getElementById('tourPrev').textContent=window.__t('tour.prev');
  document.getElementById('tourPrev').style.display=_tourIdx>0?'':'none';
  document.getElementById('tourNext').textContent=window.__t(_tourIdx===window.TOUR_STEPS.length-1?'tour.done':'tour.next');
  card.style.display='';
  document.querySelector(step.target)?.scrollIntoView({block:'center',behavior:'instant'});
  _tourPosition();
  requestAnimationFrame(_tourPosition);
  document.getElementById('tourNext').focus({preventScroll:true});
}
window.addEventListener('resize',_tourPosition);
window.addEventListener('scroll',_tourPosition,{passive:true});

function tourNext() {
  if (_tourIdx < window.TOUR_STEPS.length - 1) { _tourIdx++; _tourRender(); }
  else tourSkip();
}

function tourPrev() { if (_tourIdx > 0) { _tourIdx--; _tourRender(); } }

function tourSkip() {
  window._tourActive = false;
  releaseFocus();
  if (_tourReturnTab && typeof showTab==='function') showTab(_tourReturnTab);
  if (_tourOpener?.isConnected) _tourOpener.focus({preventScroll:true});
  document.getElementById('tourOverlay').classList.remove('open');
  document.getElementById('tourCard').style.display = 'none';
  document.getElementById('tourSpotlight').style.display = 'none';
  localStorage.setItem('orebit-tour-seen-' + (window.__tourPhaseId || 'x'), '1');
}

function _focusWorkflowDestination(n, previousFocus) {
  const workflowNavigation = previousFocus?.matches('button') &&
    previousFocus.closest('.assay-workflow-card') &&
    previousFocus.closest('.workflow-actions,.workflow-step-links,.workflow-related');
  // A continuation may disable its initiating button while its owner computes.
  // Retain that exact origin; do not move focus if the user chose another control.
  if (workflowNavigation) requestAnimationFrame(() => {
    const panel = document.getElementById('tab' + n);
    if (!_visibleFocusTarget(previousFocus) &&
        (document.activeElement === previousFocus || document.activeElement === document.body) &&
        panel?.isConnected && panel.classList.contains('active')) {
      panel.setAttribute('tabindex','-1'); panel.focus({preventScroll:true});
    }
  });
}

function _activateTab(n) {
  const previousFocus = document.activeElement;
  document.querySelectorAll('nav.tabs .tab').forEach((b, i) => {
    b.classList.toggle('active', i === n - 1);
    if (i === n - 1) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  // Main-stage and related-tool actions call showTab directly, without a
  // sidebar click. Keep the header's current location in the same router.
  const crumb = document.getElementById('orebitCrumb');
  if (crumb) {
    const name = (document.querySelector('nav.tabs .tab.active')?.textContent || '').trim();
    crumb.textContent = name;
    crumb.style.display = name ? 'inline-flex' : 'none';
  }
  document.querySelectorAll('.panel').forEach((p, i) => {
    p.classList.toggle('active', i === n - 1);
  });
  _syncTabAccessibility();
  // Workflow buttons can disappear or become hidden when their destination is
  // rendered. Announce the existing named stage after the owner finishes, without
  // adding a persistent tab stop or moving focus from an editable control.
  _focusWorkflowDestination(n, previousFocus);
  window.__updateMobileNavigation?.();
  try { _injectTabHelp(n); } catch (e) { /* non-fatal */ }
  try { _collapseTabHelpOnTouch(); } catch (e) { /* non-fatal */ }
}

function _syncTabAccessibility() {
  const rail = document.querySelector('nav.tabs');
  if (!rail) return;
  rail.setAttribute('aria-label', window.__t?.('flow.workflow') || 'Workflow');
  rail.setAttribute('aria-orientation', innerWidth >= 1080 ? 'vertical' : 'horizontal');
  rail.querySelectorAll('.tab').forEach((tab, i) => {
    if (!tab.id) tab.id = 'orebit-tab-' + (i + 1);
    const panel = document.getElementById('tab' + (i + 1));
    if (panel) {tab.setAttribute('aria-controls', panel.id); panel.setAttribute('aria-labelledby', tab.id);}
    tab.tabIndex = tab.classList.contains('active') ? 0 : -1;
  });
  if (rail.dataset.keyboardBound) return;
  rail.dataset.keyboardBound = 'true';
  // Capture before legacy phase handlers. The guided rail's visual order differs
  // from source order, and undisclosed advanced tools must not receive focus.
  rail.addEventListener('keydown', e => {
    if (!['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'].includes(e.key)) return;
    const origin = e.target.closest('.tab');
    if (!origin) return;
    const tabs = Array.from(rail.querySelectorAll('.tab')).filter(_visibleFocusTarget)
      .sort((a,b) => (Number(getComputedStyle(a).order)||0) - (Number(getComputedStyle(b).order)||0));
    const index = tabs.indexOf(origin);
    if (index < 0 || !tabs.length) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const target = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1) :
      tabs[(index + (['ArrowLeft','ArrowUp'].includes(e.key) ? -1 : 1) + tabs.length) % tabs.length];
    target.click(); target.focus({preventScroll:true});
  }, true);
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
