#!/usr/bin/env python3
"""Core -> Assay -> Resource without downloading and re-uploading files.

Added 2026-09-25. On the web (and in the installed app) the three modules share one
origin, so "Continue in Assay/Resource" hands the file the existing export would have
written to the next module through IndexedDB, and that module loads it through its own
upload input. Checked here:

  1. the button exists in web and Desktop; the Desktop bridge is called;
  2. what arrives in Assay is exactly Core's master export (same rows, same holes);
  3. what arrives in Resource is exactly Assay's composites export;
  4. the handoff is consumed once: reopening the page with ?handoff=1 loads nothing.

All three modules must be served from ONE origin (port 8767 here), as in production.
"""

import csv
import hashlib
import importlib.util
import io
import json
import os
import statistics
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright
from geological_review_fixture import reviewed_packet

BASE = os.environ.get("GEOSUITE_TEST_BASE", "http://localhost") + ":" + os.environ.get("CORE_TEST_PORT", "8767")
PASSED = FAILED = 0


def check(name, ok, detail=""):
    global PASSED, FAILED
    ok = bool(ok)
    PASSED += ok
    FAILED += not ok
    print(f"  {'✅' if ok else '❌'} {name}{(': ' + detail) if detail else ''}")


def ready(pg):
    pg.wait_for_function("() => typeof showTab === 'function' && typeof OrebitHandoff === 'object'", timeout=60000)
    pg.evaluate("""() => { document.querySelectorAll('.lang-picker-overlay,#tourOverlay').forEach(e => e.remove());
      window.orebitConfirm = async () => true; window.confirm = () => true; window.alert = () => {}; }""")


def rows_of(text):
    lines = [ln for ln in text.splitlines() if ln and not ln.startswith("#")]
    return list(csv.DictReader(io.StringIO("\n".join(lines))))


# A real closed rectangular prism makes the protocol fixture self-consistent.
# This file tests transport/escaping, not native Core interpretation acceptance.
DOMAIN = reviewed_packet({'v':[[0,0,6],[100,0,6],[100,100,6],[0,100,6],[0,0,0],[100,0,0],[100,100,0],[0,100,0]],
                          'f':[[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,7,3],[2,6,7],[3,7,4],[3,4,0]]},
                         60000, code='SAP<b>')


def main():
    with sync_playwright() as p:
        br = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        ctx = br.new_context()
        errors = []
        ctx.on('page', lambda pg: pg.on('pageerror', lambda error: errors.append(str(error))))

        print("\n── Core → Assay ──")
        core = ctx.new_page()
        core.goto(f"{BASE}/Core.html", wait_until="load", timeout=60000)
        ready(core)
        core.wait_for_function("() => STATE.assay.length > 8000", timeout=60000)
        # The default intentionally has unresolved linkage faults. A numerical
        # handoff must first load the original synthetic sources through CSV import.
        core.evaluate("""async () => {showTab(2);const files=['collar','survey','assay','geology'].map(name=>new File([sampleTablesCSV(SAMPLE_SOURCE_DATA[name])],name+'.csv',{type:'text/csv'}));await handleUpload({target:{files}});} """)
        core.wait_for_function("() => STATE.collar.length===350 && !_p1RunValidationChecks().some(c=>c.severity==='fail')")
        time.sleep(1.5)
        expected = core.evaluate("(() => { const f = OrebitHandoff.capture(exportMasterCSV); return f && f.text; })()")
        exp_rows = rows_of(expected)
        check("Core's master export can be captured", len(exp_rows) > 8000, str(len(exp_rows)))
        source_density = core.evaluate("STATE.assay.map(r => r.density)")
        check("Core exports every measured density without changing its value",
              len(source_density) == len(exp_rows) and all(float(row['density']) == float(d)
              for row, d in zip(exp_rows, source_density)))

        buttons = core.evaluate("""(() => { for (let i = 1; i <= 14; i++) { try { showTab(i); } catch (e) {}
            if (document.querySelector('[data-handoff="Assay"]')) return true; } return false; })()""")
        check("a 'Continue in Assay' button is rendered on the web", buttons)
        # S8: an accepted solid rides with the CSV. A synthetic payload stands in for Core's provider.
        core.evaluate(f"window.__orebitDomainHandoff = async () => ({json.dumps(DOMAIN)})")
        with ctx.expect_page(timeout=60000) as newp:
            core.evaluate("OrebitHandoff.send('Assay', exportMasterCSV)")
        assay = newp.value
        assay.wait_for_load_state("load")
        ready(assay)
        assay.wait_for_function(f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {len(exp_rows)}", timeout=90000)
        time.sleep(1.5)
        got_holes = set(assay.evaluate("(() => { const i = colIdx('hole_id'); return [...new Set(DATA.rows.map(r => String(r[i])))]; })()"))
        check("Assay received every row of Core's export", True, f"{len(exp_rows)} rows")
        check("…and every hole", got_holes == {r["hole_id"] for r in exp_rows}, f"{len(got_holes)} holes")
        got_density = assay.evaluate("DATA.rows.map(r => r[colIdx('density')])")
        check("Core → Assay preserves the exact density vector",
              len(got_density) == len(exp_rows) and all(float(v) == float(row['density'])
              for v, row in zip(got_density, exp_rows)))
        parent = assay.evaluate("OrebitHandoff.contexts()[0] || null")
        check("Assay attaches the verified Core parent only after its CSV import activates",
              bool(parent) and parent["project"]["sourcePhase"] == "Core"
              and [s["role"] for s in parent["project"]["sourceCapsule"]["sources"]]
              == ["collar", "survey", "assay", "geology"])
        check("Core parent retains source units, CRS, correction audit and accepted scope",
              bool(parent) and bool(parent["project"]["metadata"].get("units"))
              and parent["project"]["metadata"].get("crs") == core.evaluate("STATE.crs")
              and isinstance(parent["project"]["metadata"].get("audit", {}).get("changes"), list)
              and "validationScope" in parent["project"]["metadata"].get("audit", {}))
        check("Core parent is bound to the exact unchanged CSV bytes delivered to Assay",
              bool(parent) and parent["export"]["name"] == "drillhole-clean.csv"
              and bool(parent["export"].get("text"))
              and parent["export"]["revision"] == hashlib.sha256(parent["export"]["text"].encode()).hexdigest())
        # Saving in Assay carries the verified parent capsule forward as a signed-by-content
        # (hash-bound) relationship; the handoff itself never rewrites exported measurements.
        bundle_meta = assay.evaluate("async () => { const b = await sealProjectCapsule(buildBundle('P3.02 parent proof')); return {parents:b.sourceCapsule.parents, count:b.parentContexts.length}; }")
        check("Assay project capsule records the Core parent revision and source context",
              bundle_meta["count"] == 1 and bundle_meta["parents"] == [{
                  "sourcePhase": "Core", "revision": parent["project"]["sourceCapsule"]["revision"]}])
        check("the ?handoff=1 marker is removed from the address", "handoff" not in assay.url, assay.url)
        assay.wait_for_function("() => OrebitHandoff.domain()?.handoff.readiness === 'validated'")
        check("Assay keeps the domain Core sent", assay.evaluate("OrebitHandoff.domain()") == DOMAIN)
        assay.evaluate("showTab(2)")
        note = assay.locator("#domainHandoffNote")
        text = note.inner_text()
        check("Assay's upload stage names the received domain, escaped, with its readiness",
              note.is_visible() and "SAP<b>" in text and "60,000 m³" in text and "validated at handoff" in text, text)

        print("\n── Assay → Resource ──")
        assay.evaluate("showTab(11)")
        assay.locator('#domainProposalReason').fill('Synthetic population reviewed before handoff')
        assay.locator('#domainProposalApply').click()
        source_fingerprint = "async () => {const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([STATE.assay,STATE.geology])));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');}"
        source_before_eda = core.evaluate(source_fingerprint)
        assay.wait_for_selector('#sendAssayEDAReferenceToCore')
        assay.locator('#sendAssayEDAReferenceToCore').click()
        core.wait_for_function("() => !!window.OrebitCoreEDAReference?.exportState()", timeout=30000)
        eda_reference = core.evaluate("OrebitCoreEDAReference.exportState()")
        core.evaluate("showTab(14)")
        check("Assay native click delivers the proposal and checkpoint to the open Core project",
              eda_reference["status"] == "current"
              and eda_reference["reference"]["source"]["coreRevision"] == parent["project"]["sourceCapsule"]["revision"]
              and len(eda_reference["reference"]["proposal"]["intervals"]) == assay.evaluate("DATA.rows.length"))
        check("EDA reference retains raw labels and interval endpoints as review-only rows",
              bool(eda_reference["reference"]["checkpoint"])
              and all("from" in row and "to" in row and "sourceLabel" in row and "candidateLabel" in row
                      for row in eda_reference["reference"]["proposal"]["intervals"][:10]))
        bad_reference = core.evaluate("async () => {const before=OrebitCoreEDAReference.exportState().reference.revision;const bad=structuredClone(OrebitCoreEDAReference.exportState().reference);bad.proposal.intervals[0].candidateLabel+='!';let rejected=false;try{await OrebitCoreEDAReference.receive(bad);}catch(e){rejected=e.code==='EDA_REFERENCE_REVISION_MISMATCH';}return rejected&&OrebitCoreEDAReference.exportState().reference.revision===before;}")
        check("A modified proposal is rejected without replacing Core's accepted reference", bad_reference)
        core.locator('#coreEdaReference button').filter(has_text='Accept for review').click()
        check("Geologist can accept the proposal as a review reference without changing Core assay/geology tables",
              core.evaluate("OrebitCoreEDAReference.exportState().decision.status") == "accepted-for-review"
              and core.evaluate(source_fingerprint) == source_before_eda)
        crs_before_eda_conflict = core.evaluate("STATE.crs")
        core.evaluate("STATE.crs='EPSG:9999'")
        assay.locator('#sendAssayEDAReferenceToCore').click()
        core.wait_for_function("() => OrebitCoreEDAReference.exportState()?.status === 'stale'", timeout=30000)
        check("A Core metadata revision conflict marks the EDA reference stale and disables acceptance",
              core.locator('#coreEdaReference button').filter(has_text='Accept for review').is_disabled()
              and core.evaluate(source_fingerprint) == source_before_eda)
        core.locator('#coreEdaReference button').filter(has_text='Decline proposal').click()
        check("Declining a stale EDA proposal preserves the active raw Core tables",
              core.evaluate("OrebitCoreEDAReference.exportState().decision.status") == "rejected"
              and core.evaluate(source_fingerprint) == source_before_eda)
        core.evaluate("value => {STATE.crs=value;}", crs_before_eda_conflict)
        compact_delivery = assay.evaluate("async () => {const r=await createAssayEDAReference(OrebitHandoff.contexts(),DATA,OrebitAssayWorkflow.serialise(),{audit:{...window._domainProposal.audit},labels:window._domainProposal.labels},window._domainApplied.sourceDomains);r.checkpoint.note='x'.repeat(4*1024*1024+1);r.revision=await _opcAssayReferenceDigest(r);return OrebitHandoff.sendEDAReference(r);}")
        core.wait_for_function("() => OrebitCoreEDAReference.exportState()?.status === 'summary-only'", timeout=30000)
        check("Oversized EDA references recover as explicit summary-only packets, never as an implicit approval",
              compact_delivery.get("ok") and compact_delivery.get("status") == "summary-only"
              and core.locator('#coreEdaReference button').filter(has_text='Accept for review').is_disabled()
              and core.evaluate(source_fingerprint) == source_before_eda)

        print("\\n── Core → Assay checkpoint return ──")
        assay.evaluate("showTab(11);document.getElementById('assay-stage-note-11').value='Checkpoint before Core review';OrebitAssayWorkflow.record(11,false)")
        assay.locator('#sendAssayEDAReferenceToCore').click()
        core.wait_for_function("() => OrebitCoreEDAReference.exportState()?.status === 'current'", timeout=30000)
        core.locator('#coreEdaReference button').filter(has_text='Accept for review').click()
        core.evaluate(f"window.__orebitDomainHandoff=async()=>({json.dumps(DOMAIN)})")
        before_return = assay.evaluate("({parent:OrebitHandoff.contexts()[0].project.sourceCapsule.revision})")
        assay.evaluate("window.__p304Dataset=DATA;window.__p304Rows=DATA.rows")
        expected_checkpoint_note = core.evaluate("OrebitCoreEDAReference.exportState().reference.checkpoint.stages.find(r=>r.stage===11).note")
        assay.evaluate("() => {const current=OrebitAssayWorkflow.serialise();current.stages.find(r=>r.stage===11).note='intervening local draft';OrebitAssayWorkflow.restore(current);}")
        core.locator('#returnAssayCheckpointFromCore').click()
        assay.wait_for_function("() => document.querySelector('.assay-checkpoint-return-status')?.dataset.state === 'restored'", timeout=30000)
        return_result = assay.evaluate("({sameDataset:DATA===window.__p304Dataset,sameRows:DATA.rows===window.__p304Rows,domain:OrebitHandoff.domain(),note:OrebitAssayWorkflow.serialise().stages.find(r=>r.stage===11)?.note})")
        check("Core returns checkpoint and validated geology to the same Assay tab without raw reimport",
              assay.evaluate("window.__p304Dataset===DATA&&window.__p304Rows===DATA.rows")
              and return_result["domain"] == DOMAIN and return_result["note"] == expected_checkpoint_note
              and before_return["parent"] == parent["project"]["sourceCapsule"]["revision"])
        # Exercise the exact active source revision over the native Core→Assay return.
        # This deterministic measured packet tests the cross-module binding; the actual solid
        # intersection and packet builder are separately tested in test_core_domain_contacts.py.
        core.evaluate("""async()=>{const reference=OrebitCoreEDAReference.exportState().reference,domain=await window.__orebitDomainHandoff();
          const geologicalRevision=await _opcSha256(domain),intervals=reference.proposal.intervals.map((row,index)=>{
            const from=Number(row.from),to=Number(row.to),mid=(from+to)/2,status=index===0?'inside':index===1?'crossing':'outside';
            const spans=index===0?[{state:'inside',entryMD:from,exitMD:to}]:index===1?
              [{state:'inside',entryMD:from,exitMD:mid},{state:'outside',entryMD:mid,exitMD:to}]:[{state:'outside',entryMD:from,exitMD:to}];
            const support=spans.map(s=>({...s,supportLength:s.exitMD-s.entryMD,geologicalDomainId:s.state==='inside'?'SAP<b>':'__OUTSIDE__'}));
            const insideLength=support.filter(s=>s.state==='inside').reduce((sum,s)=>sum+s.supportLength,0);
            return {parentObservationId:['assay',row.row,String(row.holeId),String(row.from),String(row.to)].join(':'),holeId:row.holeId,from:row.from,to:row.to,
              status,geometryStatus:'measured',domains:[{code:'SAP<b>',status,insideLength,outsideLength:to-from-insideLength,boundaryLength:0,spans:support}],spans:support};});
          const packet={schema:'orebit-assay-interval-membership',version:1,sourceRevision:reference.source.assayDatasetRevision,geologicalRevision,intervals};
          packet.revision=await _opcSha256(packet);domain.intervalMembership=packet;window.__p403DomainWithMembership=domain;
          window.__orebitDomainHandoff=async()=>structuredClone(window.__p403DomainWithMembership);return packet.intervals.length;}""")
        stale_packet = core.evaluate("""async()=>{const ref=OrebitCoreEDAReference.exportState().reference;const file=OrebitHandoff.capture(exportMasterCSV);
          const ctx=await OrebitProject.createHandoffContext(file);const packet=await createAssayCheckpointReturn(ref,ctx,await window.__orebitDomainHandoff());
          packet.source.assayDatasetRevision='0'.repeat(64);packet.revision=await _opcCheckpointReturnDigest(packet);return packet;}""")
        assay.locator('#assayCheckpointReturnFile').set_input_files({"name":"stale-return.json","mimeType":"application/json","buffer":json.dumps(stale_packet).encode()})
        assay.wait_for_function("() => document.querySelector('.assay-checkpoint-return-status')?.dataset.state === 'stale'", timeout=10000)
        stale_result = assay.evaluate("({note:OrebitAssayWorkflow.serialise().stages.find(r=>r.stage===11)?.note,domain:OrebitHandoff.domain()})")
        check("A source-conflicted return is marked stale without replacing Assay rows, checkpoint or geometry",
              assay.evaluate("DATA===window.__p304Dataset&&DATA.rows===window.__p304Rows")
              and stale_result["note"] == expected_checkpoint_note and stale_result["domain"] == DOMAIN)
        core.locator('#returnAssayCheckpointFromCore').click()
        assay.wait_for_function("() => document.querySelector('.assay-checkpoint-return-status')?.dataset.state === 'restored'", timeout=30000)
        same_source_context = assay.evaluate("""async()=>{const c=await OrebitAssayWorkflow.estimationContext(),d=OrebitHandoff.domain();return {source:c.sourceRevision,geology:c.geologicalRevision,membership:c.membershipRevision,
          rows:c.parentObservationIds.length,packet:d.intervalMembership,domain:d,raw:JSON.stringify(DATA.rows)};}""")
        check("Native Core→Assay checkpoint return binds measured membership to the exact active Assay source",
              bool(same_source_context["membership"]) and same_source_context["rows"] == assay.evaluate("DATA.rows.length")
              and same_source_context["packet"]["sourceRevision"] == assay.evaluate("async()=>_opcAssayDataRevision({columns:DATA.columns||DATA.cols,rows:DATA.rows})"))
        assay.evaluate("showTab(11)")
        assay.wait_for_selector('#assay-estimation-domain-0')
        assay.locator('#assay-estimation-domain-0').check()
        assay.locator('#assay-estimation-boundary').select_option('hard')
        assay.locator('.workflow-estimation-spec input[aria-label="Reviewer identifier"]').fill('same-source-core-reviewer')
        assay.locator('.workflow-estimation-spec textarea[aria-label="Reason for this element population"]').fill('Reviewed exact Core→Assay source membership fixture')
        assay.get_by_role('button',name='Preview decisions').click()
        preview = assay.locator('.workflow-estimation-spec .workflow-status').inner_text()
        check("Same-source native editor distinguishes retain, conserved hard split and outside rejection",
              '1 retained' in preview and '1 split' in preview and f'{same_source_context["rows"]-2} rejected' in preview, preview)
        assay.get_by_role('button',name='Apply domains and open Stats').click()
        assay.wait_for_function("() => OrebitAssayWorkflow.estimationSpecReadiness().then(r=>r.status==='approved')",timeout=30000)
        assay.wait_for_function("()=>currentTab===8&&OrebitAssayWorkflow.reviewedEDAStatus()?.status==='current'")
        check("Same-source Apply opens Stats for the two measured domain parents",assay.evaluate('_scopedRows().length')==2)
        check("Same-source Apply preserves every original assay row and approves the exact packet revisions",
              same_source_context["raw"] == assay.evaluate('JSON.stringify(DATA.rows)')
              and assay.evaluate("async()=>{const s=OrebitAssayWorkflow.serialise().estimationSpec,c=await OrebitAssayWorkflow.estimationContext();return s.sourceRevision===c.sourceRevision&&s.geologicalRevision===c.geologicalRevision&&s.membershipRevision===c.membershipRevision&&s.elements[0].decisions.length===DATA.rows.length}"))
        # This injected DTO fixture tests the legacy screening transport, not
        # native reviewed preparation (covered by test_domain_native_pipeline.py).
        comp = assay.evaluate("(() => { const f = OrebitHandoff.capture(() => _exportScreeningMasterForEstimation()); return f && f.text; })()")
        comp_rows = rows_of(comp)
        check("Legacy screening transport composite export can be captured", len(comp_rows) > 100, str(len(comp_rows)))
        with ctx.expect_page(timeout=60000) as newp:
            assay.evaluate("OrebitHandoff.send('Resource', _exportScreeningMasterForEstimation)")
        res = newp.value
        res.wait_for_load_state("load")
        ready(res)
        res.wait_for_function(f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {len(comp_rows)}", timeout=90000)
        check("Resource received every composite", True, f"{len(comp_rows)} composites")
        comp_lines = comp.splitlines()
        treatment_header = next((i for i, line in enumerate(comp_lines) if line.startswith("# Treatment record")), -1)
        column_header = next((i for i, line in enumerate(comp_lines) if line and not line.startswith("#")), -1)
        rejected_comments = res.evaluate("(window._lastRejected || []).filter(row => row.raw.startsWith('#'))")
        check("Assay treatment comments precede the CSV header and Resource imports them without rejected rows",
              treatment_header >= 0 and column_header >= 0 and treatment_header < column_header and not rejected_comments,
              f"metadata line={treatment_header}, column header index={column_header}, rejected={len(rejected_comments)}")
        got_density = res.evaluate("DATA.rows.map(r => r[colIdx('density')])")
        check("Assay → Resource preserves every exported composite density",
              len(got_density) == len(comp_rows) and all(float(v) == float(row['density'])
              for v, row in zip(got_density, comp_rows)))
        supports = sorted(float(row["to_m"]) - float(row["from_m"]) for row in comp_rows
                          if float(row["to_m"]) > float(row["from_m"]))
        support_label = res.locator("#dataPreview .metric-tile").first.locator(".sub").inner_text()
        fmt = lambda value: f"{value:.4g}"
        check("Resource upload summary reports measured median and range from the imported CSV",
              supports and f"median interval {fmt(statistics.median(supports))} m" in support_label.lower()
              and f"range {fmt(supports[0])}–{fmt(supports[-1])} m" in support_label.lower(),
              f"expected {fmt(statistics.median(supports))} m, {fmt(supports[0])}–{fmt(supports[-1])} m; got {support_label}")

        doms = res.evaluate("(() => { const s = document.getElementById('setupDomain'); showTab(3); const t = document.getElementById('setupDomain'); return t ? [...t.options].map(o => o.value) : []; })()")
        res.wait_for_function("() => OrebitHandoff.domain()?.handoff.readiness === 'validated'")
        check("Assay forwards the received domain and source-bound membership to Resource unchanged",
              res.evaluate("OrebitHandoff.domain()") == assay.evaluate("OrebitHandoff.domain()"))
        res.evaluate("showTab(2)")
        check("Resource says the solid is not applied to blocks yet",
              "not applied to blocks" in res.locator("#domainHandoffNote").inner_text())
        res.evaluate("applyLanguage('id')")
        check("the notice follows the language", "tervalidasi saat dikirim" in res.locator("#domainHandoffNote").inner_text())
        res.evaluate("applyLanguage('en')")
        check("…with the domains Assay assigned", {"M0-Background", "M1-Mineralised"} <= set(doms) or len(doms) > 1, str(doms))

        saved_context = assay.evaluate("async () => { _p2ProjectName='P3.02-parent-context'; await saveCurrentProject(); const b=await dbGet(_p2ProjectName); return {count:b.parentContexts.length,revision:b.sourceCapsule.parents[0].revision,returned:!!b.assayCheckpointReturn,returnRevision:b.assayCheckpointReturn?.revision}; }")
        tampered_project = assay.evaluate("async () => { const b=structuredClone(await dbGet(_p2ProjectName)); b.assayCheckpointReturn.source.assayDatasetRevision='0'.repeat(64); b.assayCheckpointReturn.revision=await _opcCheckpointReturnDigest(b.assayCheckpointReturn); const rows=DATA.rows; let rejected=false; try { await applyBundle(b); } catch(e) { rejected=e.code==='ASSAY_CHECKPOINT_RETURN_DATASET_CONFLICT'; } return rejected&&DATA.rows===rows; }")
        check("Assay project preflight rejects a well-formed but source-conflicted saved checkpoint before changing active rows",
              tampered_project and saved_context["returned"] and bool(saved_context["returnRevision"]))
        assay.evaluate("async () => { setActiveDataset(EMBEDDED_DATA,{source:DATASET_SOURCE.SAMPLE,treatments:{},projectName:null}); await openProjectManager(); await loadProjectFromDB('P3.02-parent-context'); }")
        check("Assay IndexedDB save/reopen retains its verified Core source context",
              saved_context["count"] == 1 and saved_context["revision"] == parent["project"]["sourceCapsule"]["revision"]
              and assay.evaluate("OrebitHandoff.contexts()[0].project.sourceCapsule.revision") == saved_context["revision"]
              and assay.evaluate("OrebitHandoff.checkpointReturnRecord()?.revision") == saved_context["returnRevision"]
              and assay.evaluate("OrebitHandoff.domain()") == same_source_context["domain"]
              and assay.evaluate("OrebitAssayWorkflow.serialise().stages.find(r=>r.stage===11)?.note") == expected_checkpoint_note)

        print("\n── consumed once ──")
        again = ctx.new_page()
        again.goto(f"{BASE}/Resource.html?handoff=1", wait_until="load")
        ready(again)
        time.sleep(2.5)
        n = again.evaluate("(typeof DATA !== 'undefined' && DATA && DATA.rows) ? DATA.rows.length : 0")
        check("reopening with ?handoff=1 does not load the old file again", n != len(comp_rows), f"rows={n}")
        check("…nor the old domain", again.evaluate("OrebitHandoff.domain()") is None and again.locator("#domainHandoffNote").is_hidden())

        print("\n── Desktop EXE ──")
        exe = ctx.new_page()
        exe.add_init_script("window.__OREBIT_RT__ = {};")
        exe.goto(f"{BASE}/Core.html", wait_until="load")
        exe.wait_for_function("() => typeof showTab === 'function' && typeof OrebitHandoff === 'object'", timeout=60000)
        check("handoff controls are offered in Desktop mode", exe.evaluate("OrebitHandoff.available()") is True)
        sent = exe.evaluate("""async () => {
          window.pywebview = { api: { send_handoff: async (...args) => {
            window.__desktopSent = args; return { ok: true, launched: true };
          } } };
          const ok = await OrebitHandoff.send('Assay', () =>
            downloadFile('bridge.csv', 'hole_id,grade\\nA,1\\n', 'text/csv'));
          return { ok, args: window.__desktopSent };
        }""")
        check("Desktop sends the captured CSV through pywebview", sent["ok"]
              and sent["args"] == ["Assay", "bridge.csv", "hole_id,grade\nA,1\n"])

        sent = exe.evaluate(f"""async () => {{
          window.__orebitDomainHandoff = async () => ({json.dumps(DOMAIN)});
          await OrebitHandoff.send('Assay', () => downloadFile('bridge.csv', 'a\\n1\\n', 'text/csv'));
          return window.__desktopSent; }}""")
        check("Desktop sends the domain as a fourth argument", len(sent) == 4 and json.loads(sent[3]) == DOMAIN)

        sent_source = exe.evaluate("""async () => {
          window.__orebitSourceHandoff = file => OrebitProject.createHandoffContext(file);
          const text = '# orebit-schema=v1 source=phase1-core\\nhole_id,ni_pct\\nH1,1.2\\n';
          const ok = await OrebitHandoff.send('Assay', () => downloadFile('drillhole-clean.csv', text, 'text/csv'));
          return {ok,args:window.__desktopSent};
        }""")
        source_record = json.loads(sent_source["args"][4]) if sent_source["ok"] and len(sent_source["args"]) == 5 else {}
        check("Desktop bridge carries the Core capsule sidecar without rewriting its CSV",
              sent_source["ok"] and source_record.get("schemaVersion") == 1
              and source_record.get("export", {}).get("text") == "# orebit-schema=v1 source=phase1-core\nhole_id,ni_pct\nH1,1.2\n")

        failures=exe.evaluate("""async()=>{
          const before=JSON.stringify(window.__desktopSent);
          window.__orebitDomainHandoff=async()=>{throw Error('DOMAIN_SOURCE_CHANGED')};
          const changed=await OrebitHandoff.send('Assay',()=>downloadFile('changed.csv','a\\n1\\n','text/csv'));
          window.__orebitDomainHandoff=async()=>({schemaVersion:1,padding:'x'.repeat(8*1024*1024)});
          const oversized=await OrebitHandoff.send('Assay',()=>downloadFile('large.csv','a\\n1\\n','text/csv'));
          return {changed,oversized,unchanged:JSON.stringify(window.__desktopSent)===before};
        }""")
        check('Source-change or oversized geometry rejects the handoff instead of silently sending CSV without its solid', failures=={'changed':False,'oversized':False,'unchanged':True},str(failures))

        desktop_assay = ctx.new_page()
        stale = {**DOMAIN, "handoff": {**DOMAIN["handoff"], "readiness": "stale"}}
        record = {"name": "master.csv", "text": expected, "domain": json.dumps(stale), "ts": int(time.time() * 1000)}
        desktop_assay.add_init_script(
            "window.__OREBIT_RT__={};window.__desktopTakeCalls=0;"
            "window.pywebview={api:{take_handoff:async()=>{"
            "window.__desktopTakeCalls++;return "
            + json.dumps(record) + ";}}};"
        )
        desktop_assay.goto(f"{BASE}/Assay.html", wait_until="load", timeout=60000)
        ready(desktop_assay)
        try:
            desktop_assay.wait_for_function(
                f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {len(exp_rows)}",
                timeout=30000,
            )
        except Exception:
            pass
        state = desktop_assay.evaluate("""() => ({
          takeCalls: window.__desktopTakeCalls,
          bridge: !!(window.pywebview && window.pywebview.api),
          input: !!document.getElementById('fileInput'),
          rows: typeof DATA !== 'undefined' && DATA && DATA.rows ? DATA.rows.length : null,
          file: document.getElementById('fileInput')?.files?.[0]?.name || null
        })""")
        check("Desktop receiver imports every Core row via file input",
              state["rows"] == len(exp_rows), str(state))
        desktop_assay.evaluate("showTab(2)")
        dnote = desktop_assay.locator("#domainHandoffNote")
        check("a stale domain arrives as stale, with no volume claimed",
              dnote.get_attribute("data-readiness") == "stale" and "m³" not in dnote.inner_text()
              and "stale at handoff" in dnote.inner_text(), dnote.inner_text())

        print("\n── Geometry belongs to the successfully activated CSV ──")
        # A delivered capsule is not an accepted import. A bad file must never
        # lend its geometry to the sample that stayed active or a later upload.
        bad = ctx.new_page()
        failed_record = {**record, "text": "hole_id,ni_pct\nA,1.5\n", "domain": json.dumps(DOMAIN)}
        bad.add_init_script("window.__OREBIT_RT__={};window.pywebview={api:{take_handoff:async()=> (" + json.dumps(failed_record) + ")}};")
        bad.goto(f"{BASE}/Assay.html", wait_until="load")
        ready(bad)
        bad.wait_for_function("() => window._lastImportReport && !window._lastImportReport.ready")
        check('Failed Assay import keeps geometry out of the active sample and native report', bad.evaluate('OrebitHandoff.domain()') is None and bad.locator('#domainHandoffNote').is_hidden())
        bad.locator('#fileInput').set_input_files({'name':'corrected.csv','mimeType':'text/csv','buffer':expected.encode()})
        bad.wait_for_function(f"() => DATA.rows.length === {len(exp_rows)}")
        check('A later corrected CSV does not inherit the failed handoff geometry', bad.evaluate('OrebitHandoff.domain()') is None)

        res.locator('#fileInput').set_input_files({'name':'different-import.csv','mimeType':'text/csv','buffer':comp.encode()})
        res.wait_for_function("() => DATA.name === 'different-import.csv'")
        check('A successful manual Resource CSV replacement clears previous geometry and notice', res.evaluate('OrebitHandoff.domain()') is None and res.locator('#domainHandoffNote').is_hidden())
        desktop_assay.evaluate('resetToSample()')
        check('Assay sample reset retires received geometry at the shared dataset owner', desktop_assay.evaluate('OrebitHandoff.domain()') is None and dnote.is_hidden())

        # Source binding must survive the ordinary manual mapping path, without
        # bypassing the import gate or changing unknown column names in code.
        mapped = ctx.new_page()
        mapped_record = {**record, 'name':'mapped.csv', 'text':'hole_id,q1,q2,q3,ni_pct\nA,1,2,3,1.5\n', 'domain':json.dumps(DOMAIN)}
        mapped.add_init_script("window.__OREBIT_RT__={};window.pywebview={api:{take_handoff:async()=> (" + json.dumps(mapped_record) + ")}};")
        mapped.goto(f"{BASE}/Resource.html", wait_until="load")
        ready(mapped)
        mapped.wait_for_function("() => !!document.getElementById('p3ApplyMapping')")
        check('Resource geometry stays pending until the manual mapping gate succeeds', mapped.evaluate('OrebitHandoff.domain()') is None)
        for target, source in [('midx','q1'),('midy','q2'),('midz','q3')]:
            mapped.locator(f'.colmap-sel[data-target="{target}"]').select_option(source)
        mapped.locator('#p3ApplyMapping').click()
        mapped.wait_for_function("() => DATA.name === 'mapped.csv' && DATA.rows.length === 1")
        mapped.wait_for_function("() => OrebitHandoff.domain()?.handoff.readiness === 'validated'")
        check('Actual mapping Apply attaches geometry only to its own delivered CSV', mapped.evaluate('OrebitHandoff.domain()') == DOMAIN)
        frozen=mapped.evaluate("""()=>{const d=OrebitHandoff.domain(),before=d.domains[0].build.review.reason;
          try{d.domains[0].build.review.reason='mutated';d.domains[0].build.mesh.v[0][0]=999;}catch{}
          return Object.isFrozen(d.domains[0].build.mesh.v[0])&&d.domains[0].build.review.reason===before&&d.domains[0].build.mesh.v[0][0]===0;}""")
        check('Received reviewed geology is recursively immutable through the public handoff accessor',frozen)
        invalid_return=mapped.evaluate("""async()=>{const before=OrebitHandoff.domain(),bad=JSON.parse(JSON.stringify(before));
          bad.domains[0].build.review.reason='changed without review';
          return !(await OrebitHandoff.acceptReturnedDomain(bad))&&OrebitHandoff.domain()===before;}""")
        check('A tampered returned review cannot replace the active received geometry',invalid_return)
        return_order=mapped.evaluate("""async()=>{const domain=OrebitHandoff.domain(),actual=reviewedGeologicalSnapshot,releases=[];
          reviewedGeologicalSnapshot=async value=>{await new Promise(resolve=>releases.push(resolve));return actual(value);};
          try{const older=OrebitHandoff.acceptReturnedDomain(domain),newerPacket=JSON.parse(JSON.stringify(domain));
            newerPacket.domains[0].build.review.reason='A later explicit review';
            newerPacket.domains[0].build.reviewHash=await _opcSha256(_opcGeometryCanonical(newerPacket.domains[0].build.review));
            const newer=OrebitHandoff.acceptReturnedDomain(newerPacket);releases[1]();const accepted=await newer;
            releases[0]();return accepted&&!(await older)&&OrebitHandoff.domain().domains[0].build.review.reason==='A later explicit review';
          }finally{reviewedGeologicalSnapshot=actual;}}""")
        check('A delayed older same-source return cannot overwrite the newer reviewed return',return_order)
        delayed_return=mapped.evaluate("""async()=>{const domain=OrebitHandoff.domain(),actual=reviewedGeologicalSnapshot;
          let release;reviewedGeologicalSnapshot=async value=>{await new Promise(resolve=>release=resolve);return actual(value);};
          try{const pending=OrebitHandoff.acceptReturnedDomain(domain);resetToSample();release();
            return !(await pending)&&OrebitHandoff.domain()===null;
          }finally{reviewedGeologicalSnapshot=actual;}}""")
        check('Dataset replacement while review hashing is pending retires the delayed returned geology',delayed_return)
        mapped.evaluate('resetToSample()')
        check('Resource sample reset clears mapped handoff geometry', mapped.evaluate('OrebitHandoff.domain()') is None)

        for invalid_kind in ('missing-review','changed-mesh'):
            bad_packet=json.loads(json.dumps(DOMAIN))
            if invalid_kind=='missing-review':
                del bad_packet['domains'][0]['build']['review']
            else:
                bad_packet['domains'][0]['build']['mesh']['v'][0][0]=1
            rejected=ctx.new_page()
            rejected_record={**record,'name':'review-boundary.csv','text':'hole_id,midx,midy,midz,ni_pct\nA,1,2,3,1.5\n','domain':json.dumps(bad_packet)}
            rejected.add_init_script('window.__OREBIT_RT__={};window.pywebview={api:{take_handoff:async()=>('+json.dumps(rejected_record)+')}};')
            rejected.goto(f'{BASE}/Resource.html',wait_until='load')
            ready(rejected)
            rejected.wait_for_function("() => DATA.name==='review-boundary.csv'&&OrebitHandoff.domain()?.handoff.readiness==='stale'")
            check('Native Resource import downgrades '+invalid_kind+' without changing imported samples',
                  rejected.evaluate("OrebitHandoff.domain().handoff.volume===null&&DATA.rows.length===1"))
            rejected.close()

        # Save/reopen is intentionally exercised after the live return route: Core
        # reload can correctly mark an old reference stale when its state revision
        # changed. Keep that lifecycle test from invalidating the live route above.
        eda_project = core.evaluate("async () => { const before=OrebitCoreEDAReference.exportState(); const saved=await OrebitProject.save('P3.05-eda-roundtrip'); await OrebitCoreEDAReference.restore(null); await OrebitProject.load('P3.05-eda-roundtrip'); const after=OrebitCoreEDAReference.exportState(); return {saved:!!saved,status:after?.status,revision:after?.reference?.revision,decision:after?.decision?.status,beforeRevision:before.reference.revision,beforeDecision:before.decision.status,expectedState:after?.reference?.source?.coreProjectStateRevision,actualState:await OrebitProject.currentProjectStateRevision(),expectedCore:after?.reference?.source?.coreRevision,actualCore:await OrebitProject.currentCapsuleRevision()}; }")
        check("Core project save/reopen restores the bound Assay EDA reference and its review decision",
              eda_project["saved"] and eda_project["status"] in ("current", "stale")
              and eda_project["revision"] == eda_project["beforeRevision"]
              and eda_project["decision"] == eda_project["beforeDecision"], str(eda_project))
        malformed_capsule = core.evaluate("async () => { const b=structuredClone(await dbGet('P3.05-eda-roundtrip')); const active=STATE.assay; b.sourceCapsule.revision='0'.repeat(64); let rejected=false; try { await applyBundle(b); } catch(e) { rejected=true; } return rejected&&STATE.assay===active; }")
        check("Malformed Core capsule import fails before replacing the active dataset", malformed_capsule)
        cancelled_load = core.evaluate("async () => { const prompt=window.prompt; window.prompt=()=>null; try { const active=STATE.assay; const result=await OrebitProject.load(); return result===null&&STATE.assay===active; } finally { window.prompt=prompt; } }")
        check("Cancelling the saved-project picker keeps the active Core dataset unchanged", cancelled_load)
        same_name_replacement = core.evaluate("async () => { const b=structuredClone(await dbGet('P3.05-eda-roundtrip')); const old=b.sourceCapsule.revision; b.phase1.collar_csv+=' '; await sealProjectCapsule(b); await applyBundle(b); const active=OrebitCoreEDAReference.exportState(); return b.name==='P3.05-eda-roundtrip'&&b.sourceCapsule.revision!==old&&active?.status==='stale'; }")
        check("Replacing a same-name Core project's bound source revision marks its saved EDA reference stale", same_name_replacement)
        newer_core = ctx.new_page()
        newer_core.goto(f"{BASE}/Core.html", wait_until="load", timeout=60000)
        ready(newer_core)
        newer_tab = core.evaluate("async () => { await OrebitProject.save('P3.05-eda-roundtrip'); const r=structuredClone(OrebitCoreEDAReference.exportState().reference); r.source.coreRevision=await OrebitProject.currentCapsuleRevision(); r.source.coreProjectStateRevision=await OrebitProject.currentProjectStateRevision(); r.revision=await _opcAssayReferenceDigest(r); return r; }")
        newer_core.evaluate("async () => { const b=await dbGet('P3.05-eda-roundtrip'); b.metadata.crs='EPSG:9999'; await sealProjectCapsule(b); await dbPut(b); }")
        newer_tab_conflict = core.evaluate("async reference => (await OrebitCoreEDAReference.receive(reference)).status === 'stale'", newer_tab)
        check("A newer same-origin tab's saved same-project revision makes the older Core tab reject an EDA packet as stale", newer_tab_conflict)
        check('All native handoff pages complete without uncaught browser errors', not errors, str(errors))

        br.close()

        spec = importlib.util.spec_from_file_location(
            "orebit_wrapper_handoff_test", "exe-wrapper/pywebview/orebit_wrapper.py")
        wrapper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(wrapper)
        with tempfile.TemporaryDirectory(prefix="orebit-handoff-test-") as folder:
            wrapper._handoff_dir = lambda: folder
            source_json = json.dumps({"schemaVersion": 1, "revision": "a" * 64})
            sent = wrapper.FileAPI("Core").send_handoff("Assay", "drillhole-clean.csv", expected, None, source_json)
            received = wrapper.FileAPI("Assay").take_handoff()
            check("Desktop Python bridge persists and consumes the optional Core parent sidecar",
                  sent.get("ok") and received.get("source") == source_json and received.get("text") == expected)
            too_large = wrapper.FileAPI("Core").send_handoff(
                "Assay", "drillhole-clean.csv", "x", None, "x" * (32 * 1024 * 1024 + 1))
            check("Desktop Python bridge rejects an oversized parent packet instead of silently dropping it",
                  not too_large.get("ok") and not os.path.exists(os.path.join(folder, "Assay.json")))
            reference_sent = wrapper.FileAPI("Assay").send_eda_reference(source_json)
            reference_received = wrapper.FileAPI("Core").take_eda_reference()
            check("Desktop Python bridge queues and consumes the reverse Assay EDA reference once",
                  reference_sent.get("ok") and reference_received == source_json
                  and wrapper.FileAPI("Core").take_eda_reference() is None)
            returned = wrapper.FileAPI("Core").send_assay_checkpoint_return(source_json)
            returned_text = wrapper.FileAPI("Assay").take_assay_checkpoint_return()
            wrapper.FileAPI("Core").send_assay_checkpoint_return(source_json)
            expired_path = os.path.join(folder, "Assay-return.json")
            with open(expired_path, "r", encoding="utf-8") as expired_file:
                expired_packet = json.load(expired_file)
            expired_packet["ts"] = 1
            with open(expired_path, "w", encoding="utf-8") as expired_file:
                json.dump(expired_packet, expired_file)
            expired_return = wrapper.FileAPI("Assay").take_assay_checkpoint_return()
            oversized_return = wrapper.FileAPI("Core").send_assay_checkpoint_return("x" * (8 * 1024 * 1024 + 1))
            check("Desktop Python bridge queues and consumes Core checkpoint return once with a hard size limit",
                  returned.get("ok") and returned_text == source_json
                  and wrapper.FileAPI("Assay").take_assay_checkpoint_return() is None
                  and not oversized_return.get("ok"))
            check("Desktop Python bridge rejects expired one-use checkpoint returns",
                  expired_return is None)
    print(f"\n  MODULE HANDOFF: {PASSED} passed, {FAILED} failed")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
