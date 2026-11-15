/* NAV-01: shared stage navigation; calculation and data import remain with each module owner. */
(function () {
  'use strict';
  var MODE_KEY = 'orebit.journeyMode.v1';
  var mode = 'quick';
  var resultAnchor = null;
  var quickAdvancedOpen = false;
  try { mode = localStorage.getItem(MODE_KEY) === 'detailed' ? 'detailed' : 'quick'; } catch (e) {}
  // The Desktop EXE has no same-window module handoff yet (SHELL-1), so the Quick run cannot continue there:
  // it uses the Detailed workflow only and does not offer the Quick/Detailed switch.
  if (window.__OREBIT_RT__ && !window.__OREBIT_RT__.single) mode = 'detailed';
  var here = (location.pathname.match(/(Core|Assay|Resource)\.html$/) || [])[1] || null;
  if (!here) return;
  var advancedClass = here === 'Assay' ? 'assay-advanced-open' : 'screening-advanced-open';
  var handoffPanel = /[?&]handoff=1(?:&|$)/.test(location.search) ? Number(new URLSearchParams(location.search).get('journeyStage')) : 0;
  // [stage number, owning module, panel opened by its button]
  var STAGES = [[1, 'Core', 2], [2, 'Assay', 3], [3, 'Assay', 11], [4, 'Core', 14], [5, 'Assay', 7], [6, 'Resource', 3], [7, 'Resource', 7]];
  var PANEL_STAGE = {
    Core: function (n) { return n === 14 ? 4 : 1; },
    Assay: function (n) { return n === 10 || n === 11 ? 3 : n === 7 || n === 9 || n === 13 ? 5 : 2; },
    Resource: function (n) { return n >= 7 ? 7 : 6; }
  };
  var tr = function (key) { return window.__t ? window.__t(key) : key; };
  var LABEL = {
    1: function () { return tr('journey.s1'); }, 2: function () { return tr('journey.s2'); }, 3: function () { return tr('journey.s3'); },
    4: function () { return tr('journey.s4'); }, 5: function () { return tr('journey.s5'); }, 6: function () { return tr('journey.s6'); },
    7: function () { return tr('journey.s7'); }
  };
  function activePanel() {
    var panel = document.querySelector('.panel.active');
    var n = panel && /^tab(\d+)$/.exec(panel.id);
    return n ? Number(n[1]) : 1;
  }
  function findProject(phase, contexts) {
    for (var i = 0; i < contexts.length; i++) {
      var project = contexts[i] && contexts[i].project;
      if (!project) continue;
      if (project.sourcePhase === phase) return project;
      var parent = findProject(phase, Array.isArray(project.parentContexts) ? project.parentContexts : []);
      if (parent) return parent;
    }
    return null;
  }
  function projectContext(phase) {
    return typeof OrebitHandoff === 'object' ? findProject(phase, OrebitHandoff.contexts()) : null;
  }
  function remoteReady(module) {
    if (module === 'Core') return !!projectContext('Core');
    if (module === 'Assay') return here === 'Core' ? !!(STATE.merged && STATE.merged.length && _coreAnalysisReady()) : !!projectContext('Assay');
    if (module === 'Resource') return here === 'Assay' ? !!(DATA && DATA.rows && DATA.rows.length) : false;
    return false;
  }
  function openRemoteStage(module, panel) {
    if (window.OrebitQuickRun) OrebitQuickRun.clear();
    if (module === 'Assay' && here === 'Core') return OrebitHandoff.sendSameWindow('Assay', exportMasterCSV, panel);
    if (module === 'Resource' && here === 'Assay') return sendResourceHandoff(false, true, panel);
    if (module === 'Core') return OrebitHandoff.sendCoreProject(projectContext('Core'), window, panel);
    if (module === 'Assay' && here === 'Resource') return OrebitHandoff.sendProjectSameWindow('Assay', projectContext('Assay'), panel);
    return Promise.resolve(false);
  }
  function routeAfterHandoff() {
    if (!handoffPanel || !['Assay', 'Resource'].includes(here)) return;
    var panel = handoffPanel; handoffPanel = 0;
    showTab(panel);
  }
  function bindHeaderModuleLinks() {
    if (window.__OREBIT_RT__ && !window.__OREBIT_RT__.single) return;
    document.querySelectorAll('a[data-phase-switch]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        var target = (link.getAttribute('href').match(/^(Core|Assay|Resource)\.html$/) || [])[1];
        if (!target || target === here) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (!remoteReady(target)) { if (typeof toast === 'function') toast(tr('journey.stageUnavailable'), 'warn'); return; }
        Promise.resolve(openRemoteStage(target, target === 'Core' ? 2 : 3)).then(function (ok) {
          if (!ok && typeof toast === 'function') toast(tr('journey.stageFailed'), 'warn');
        }).catch(function (error) { console.warn('[journey header handoff]', error); if (typeof toast === 'function') toast(tr('journey.stageFailed'), 'warn'); });
      });
    });
  }
  function renderMode() {
    if (window.__OREBIT_RT__ && !window.__OREBIT_RT__.single) { document.body.classList.remove('journey-quick'); return; }
    var title = document.querySelector('header.orebit-header .title-block');
    if (!title) return;
    var switcher = document.getElementById('journeyMode');
    if (!switcher) { switcher = document.createElement('div'); switcher.id='journeyMode'; switcher.className='journey-mode'; }
    var focusedMode = switcher.contains(document.activeElement) && document.activeElement.dataset.journeyMode;
    var mobileHeader = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    var header = title.closest('header.orebit-header');
    var host = mobileHeader ? header.parentElement : title.parentElement.parentElement;
    if (switcher.parentElement !== host) {
      if (mobileHeader && header) header.after(switcher);
      else host.append(switcher);
    }
    document.body.classList.toggle('journey-quick',mode==='quick');
    switcher.replaceChildren();
    [['quick','journey.mode.quick'],['detailed','journey.mode.detailed']].forEach(function (entry) {
      var button=document.createElement('button');button.type='button';button.dataset.journeyMode=entry[0];button.textContent=tr(entry[1]);button.setAttribute('aria-pressed',String(mode===entry[0]));
      button.addEventListener('click',function(){setMode(entry[0]);});switcher.append(button);
    });
    if (focusedMode) switcher.querySelector('[data-journey-mode="'+focusedMode+'"]').focus({preventScroll:true});
  }
  function render() {
    renderMode();
    // The strip lives at the top of the active stage panel: panels already sit in the
    // content column on desktop and in the single column on a phone.
    var panelHost = document.querySelector('.panel.active');
    if (!panelHost) return;
    var sidebarHost = mode === 'quick' && window.matchMedia('(min-width: 1080px)').matches && document.querySelector('nav.tabs');
    var host = sidebarHost || panelHost;
    if (sidebarHost && activePanel() === 1 && document.body.classList.contains(advancedClass) !== quickAdvancedOpen) {
      // Restore the user's disclosure choice through its owner so the label,
      // aria-expanded and displayed tools stay in agreement after auto-visits.
      var advanced = document.querySelector('nav.tabs .workflow-nav-disclosure');
      if (advanced) advanced.click();
    }
    var bar = document.getElementById('journeyBar');
    if (!bar) {
      bar = document.createElement('nav');
      bar.id = 'journeyBar'; bar.className = 'journey-bar';
    }
    if (bar.parentElement !== host || host.firstElementChild !== bar) host.prepend(bar);
    if (here === 'Resource' && activePanel() === 1) {
      var summary = document.getElementById('resultSummary');
      if (summary && summary.parentElement === panelHost) {
        if (!resultAnchor) { resultAnchor = document.createComment('detailed result location'); summary.before(resultAnchor); }
        if (mode === 'quick' && sidebarHost && panelHost.firstElementChild !== summary) panelHost.prepend(summary);
        else if (mode === 'quick' && !sidebarHost && bar.nextSibling !== summary) bar.after(summary);
        else if (mode === 'detailed' && resultAnchor.nextSibling !== summary) resultAnchor.after(summary);
      }
    }
    // A short, always visible explanation of the two modes, with the way to the other one.
    var explain = (window.__OREBIT_RT__ && !window.__OREBIT_RT__.single) ? null : document.getElementById('journeyExplain');
    if (!explain && !(window.__OREBIT_RT__ && !window.__OREBIT_RT__.single)) { explain = document.createElement('div'); explain.id = 'journeyExplain'; explain.className = 'journey-explain'; }
    var line = document.createElement('p'), other = document.createElement('button');
    line.textContent = tr(mode === 'quick' ? 'journey.explain.quick' : 'journey.explain.detailed');
    other.type = 'button'; other.className = 'journey-explain-switch'; other.dataset.journeySwitch = mode === 'quick' ? 'detailed' : 'quick';
    other.textContent = tr(mode === 'quick' ? 'journey.explain.toDetailed' : 'journey.explain.toQuick');
    // The header switch is the keyboard route; this link is a pointer shortcut, kept out of the tab order so the
    // first Tab on a stage page still reaches the stage strip.
    other.tabIndex = -1;
    other.addEventListener('click', function () { setMode(other.dataset.journeySwitch); });
    if (explain) {
    explain.replaceChildren(line);
    if (mode === 'quick') { var hint = document.createElement('p'); hint.className = 'journey-explain-hint'; hint.textContent = tr('journey.explain.hint'); explain.append(hint); }
    explain.append(other);
    var anchor = bar.nextSibling && bar.nextSibling.id === 'resultSummary' ? bar.nextSibling : bar;
    if (anchor.nextSibling !== explain) anchor.after(explain);
    }
    bar.setAttribute('aria-label', tr(mode === 'quick' ? 'journey.mode.quick' : 'journey.label'));
    if(mode==='quick'){
      var quick=[['journey.quick.add','Core',2],['journey.quick.check','Core',1],['journey.quick.estimate','Core',1],['journey.quick.result','Resource',1]],list=document.createElement('ol');
      var summary = document.getElementById(here === 'Core' ? 'coreCheckSummaryImport' : 'resultSummary'),
        resultState = summary && summary.dataset.state,
        sample = here === 'Core' && typeof window.__isSampleData === 'function' && window.__isSampleData(),
        dash = here === 'Core' ? document.getElementById('coreCheckSummary') : null,
        // The blocked built-in sample is still an invitation to add data; once it is ready (or is the user's own) we are in Check.
        coreStep = (sample && dash && dash.dataset.state === 'blocked') || (activePanel() === 2 && !(summary && !summary.hidden)) ? 1 : 2,
        resourceStep = ['ready', 'partial', 'empty'].indexOf(resultState) >= 0 ? 4 : 3,
        currentStep = here === 'Core' ? coreStep : here === 'Assay' ? 3 : resourceStep,
        estimate = document.querySelector('[data-check-action=estimate]');
      quick.forEach(function(step,i){
        // Resource owns Estimate (its review and run) as well as Result; Core owns Add data and Check.
        var n=i+1,owner=here==='Resource'&&n>=3?'Resource':step[1],local=here===owner,
          back=!local&&here==='Resource'&&owner==='Core'&&!(window.__OREBIT_RT__ && !window.__OREBIT_RT__.single)&&remoteReady('Core');
        var item=document.createElement('li'),node=document.createElement(local||back?'button':'span');
        node.className='journey-stage';node.dataset.journeyStage=String(n);
        if(local){
          node.type='button';
          node.addEventListener('click',function(){
            if(here==='Core'&&n===3){if(estimate&&!estimate.disabled)estimate.click();}
            else if(here==='Resource')showTab(1);
            else showTab(n===2&&document.body.classList.contains('core-own-data')?2:step[2]);
          });
        }else if(back){
          node.type='button';node.title=tr('journey.otherModule').replace('{module}','Core');
          node.addEventListener('click',function(){
            Promise.resolve(openRemoteStage('Core',2)).then(function(ok){if(!ok&&typeof toast==='function')toast(tr('journey.stageFailed'),'warn');})
              .catch(function(error){console.warn('[journey quick back]',error);if(typeof toast==='function')toast(tr('journey.stageFailed'),'warn');});
          });
        }else node.title=tr('journey.otherModule').replace('{module}',owner);
        if(n===currentStep){item.className='is-current';node.setAttribute('aria-current','step');}
        if(here==='Core'&&n===3&&(!estimate||estimate.disabled)){
          node.setAttribute('aria-disabled','true');node.title=tr('journey.quick.blocked');
          node.disabled=true;
        }
        var num=document.createElement('span');num.className='journey-num';num.textContent=String(n);
        var name=document.createElement('span');name.className='journey-name';name.textContent=tr(step[0]);
        node.append(num,name);item.append(node);list.append(item);
      });
      bar.replaceChildren(list);bar.classList.add('is-quick');return;
    }
    bar.classList.remove('is-quick');
    var current = PANEL_STAGE[here](activePanel());
    // Phone: one quiet line saying where you are. The bottom navigation and the Steps drawer already
    // move between stages there, so the strip adds no extra row of touch targets.
    var compact = !!(window.matchMedia && window.matchMedia('(max-width: 820px)').matches);
    var list = document.createElement('ol');
    STAGES.forEach(function (stage) {
      var n = stage[0], module = stage[1], panel = stage[2], item = document.createElement('li');
      var local = module === here && !(compact && n === current), remote = module !== here && !compact && !(window.__OREBIT_RT__ && !window.__OREBIT_RT__.single), node = document.createElement(local || remote ? 'button' : 'span');
      node.className = 'journey-stage';
      if (local) { node.type = 'button'; node.addEventListener('click', function () { showTab(panel); }); }
      else if (remote) {
        node.type = 'button';
        node.title = tr(remoteReady(module) ? 'journey.otherModule' : 'journey.stageUnavailable').replace('{module}', module);
        if (!remoteReady(module)) node.setAttribute('aria-disabled', 'true');
        node.addEventListener('click', function () {
          if (!remoteReady(module)) { if (typeof toast === 'function') toast(tr('journey.stageUnavailable'), 'warn'); return; }
          Promise.resolve(openRemoteStage(module, panel)).then(function (ok) { if (!ok && typeof toast === 'function') toast(tr('journey.stageFailed'), 'warn'); }).catch(function (error) { console.warn('[journey stage handoff]', error); if (typeof toast === 'function') toast(tr('journey.stageFailed'), 'warn'); });
        });
      } else if (module !== here) node.title = tr('journey.otherModule').replace('{module}', module);
      node.dataset.journeyStage = String(n); node.dataset.journeyModule = module;
      node.setAttribute('aria-label', n + '. ' + LABEL[n]() + ' (' + module + ')');
      if (n === current) { node.setAttribute('aria-current', 'step'); item.className = 'is-current'; }
      var num = document.createElement('span'); num.className = 'journey-num'; num.textContent = String(n);
      var name = document.createElement('span'); name.className = 'journey-name'; name.textContent = LABEL[n]();
      var tag = document.createElement('span'); tag.className = 'journey-module'; tag.textContent = module;
      node.append(num, name, tag); item.append(node); list.append(item);
    });
    bar.replaceChildren(list);
  }
  function start() {
    bindHeaderModuleLinks();
    document.addEventListener('click', function (event) {
      if (event.target.closest('.workflow-nav-disclosure')) quickAdvancedOpen = document.body.classList.contains(advancedClass);
    });
    render();
    window.addEventListener('orebit-handoff-activated', routeAfterHandoff);
    if (['Assay', 'Resource'].includes(here) && typeof OrebitHandoff === 'object') {
      OrebitHandoff.takeProjectSameWindow(here).then(function (handoff) {
        if (!handoff) return;
        var load = here === 'Assay' ? window.applyBundle : window.loadBundle;
        if (typeof load !== 'function') throw Error('PROJECT_STAGE_LOADER_UNAVAILABLE');
        return Promise.resolve(load(handoff.project)).then(function () { showTab(handoff.panel); });
      }).catch(function (error) { console.warn('[journey project handoff]', error); if (typeof toast === 'function') toast(tr('journey.stageFailed'), 'warn'); });
    }
    // Follow stage changes and language changes without wrapping any module function.
    var pending = false, schedule = function () { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; render(); }); };
    document.querySelectorAll('.panel').forEach(function (panel) {
      new MutationObserver(schedule).observe(panel, { attributes: true, attributeFilter: ['class'] });
      // A stage that prepends its own guide card would push the strip down; put it back on top.
      // Moving the strip only happens when it is not first, so this cannot loop.
      new MutationObserver(function () {
        if (!panel.classList.contains('active') || !panel.firstElementChild) return;
        var sidebar = mode === 'quick' && window.matchMedia('(min-width: 1080px)').matches;
        if (!sidebar && panel.firstElementChild.id !== 'journeyBar') schedule();
        else if (sidebar && here === 'Resource' && activePanel() === 1 && panel.firstElementChild.id !== 'resultSummary') schedule();
      }).observe(panel, { childList: true });
    });
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    if (window.matchMedia) { var query = window.matchMedia('(max-width: 820px)'); if (query.addEventListener) query.addEventListener('change', schedule); }
    if (window.matchMedia) { var sidebar = window.matchMedia('(min-width: 1080px)'); if (sidebar.addEventListener) sidebar.addEventListener('change', schedule); }
    if (window.matchMedia) { var compact = window.matchMedia('(max-width: 768px)'); if (compact.addEventListener) compact.addEventListener('change', renderMode); }
  }
  function setMode(value) {
    var was = mode;
    mode = value === 'detailed' ? 'detailed' : 'quick';
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
    // Returning to Quick from a Detailed stage lands on the Quick screen for this module,
    // so the user is never left on a stage page that the four-step rail does not describe.
    if (was === 'detailed' && mode === 'quick' && typeof showTab === 'function') {
      if (here === 'Resource') showTab(1);
      else if (here === 'Core') showTab(document.body.classList.contains('core-own-data') ? 2 : 1);
    }
    // The Core dashboard's lead action depends on the mode (Import in Quick, Start review in Detailed).
    if (was !== mode && window.OrebitScreeningWorkflow && typeof OrebitScreeningWorkflow.refresh === 'function') OrebitScreeningWorkflow.refresh();
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.OrebitJourney = { render: render, setMode: setMode, stageOf: function (n) { return PANEL_STAGE[here](n); } };
})();
