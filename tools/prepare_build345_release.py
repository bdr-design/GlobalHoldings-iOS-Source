#!/usr/bin/env python3
"""One-time, fail-closed source promotion for experimental Build 345.
Edits original owner modules, commits them before any build, never reads an IPA.
"""
from pathlib import Path
import hashlib,json,re,subprocess
from verify_current_source import verify,inventory,tree_digest,digest
ROOT=Path(__file__).resolve().parents[1]
BASE='b2f74fae5ceaa126c8b6ecbb6ddc24ade0e24654'
BASE_TREE='e81ce91e355c7ad7838b4dd19f347873aea8d8a581ed86f4f1e69f5d8b5b2fa9'
VERSION='3.0.3'
BUILD=345
BRANCH='fix/build345-time-frame-root'

def replace(rel,old,new):
    path=ROOT/rel;text=path.read_text(encoding='utf-8')
    if text.count(old)!=1:raise ValueError('Ambiguous or missing source anchor: '+rel)
    path.write_text(text.replace(old,new),encoding='utf-8')

def write_json(rel,data):
    (ROOT/rel).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

before=verify(ROOT)
if (before['source_tree_sha256'],before['build'],before['version'])!=(BASE_TREE,344,'3.0.2'):
    raise ValueError('Source promotion requires exact verified Build344; no legacy fallback')
if digest(ROOT/'WebApp/mobility-core.js')!='b5ffb95fabec7dc96cfca044fa64eeccc3ff73c2e35677b7f12cd18ea2cfc63d':
    raise ValueError('Unexpected Mobility source bytes')
replace('WebApp/mobility-core.js',"  function ensure(state,explicitOwner=''){\n","  const normalizedMobility=new WeakMap();\n  const MOBILITY_ROW_KEYS=Object.freeze(['vehicles','drivers','rideRequests','activeTrips','tripArchive','tripArchivePending','events','capitalCenters']);\n  const MOBILITY_KPI_DEFAULTS=Object.freeze({requests:0,accepted:0,completed:0,cancelled:0,grossBookings:0,driverPayouts:0,platformRevenue:0,avgRating:4.91,acceptanceRate:100,completionRate:100});\n  const MOBILITY_ZONES_JSON=JSON.stringify(ZONES);\n  function ensure(state,explicitOwner=''){\n")
replace('WebApp/mobility-core.js',"    const ownerCompanyId=mobilityOwnerCompanyId(state,explicitOwner),m=state.mobility=state.mobility&&typeof state.mobility==='object'?state.mobility:{};\n    if(m.ownerCompanyId&&String(m.ownerCompanyId)!==ownerCompanyId)throw new Error('mobility-state-owner-conflict');m.ownerCompanyId=ownerCompanyId;\n    m.schema='gh-mobility-v4';m.version=VERSION;\n    for(const key of ['vehicles','drivers','rideRequests','activeTrips','tripArchive','tripArchivePending','events','capitalCenters'])m[key]=Array.isArray(m[key])?m[key].filter(Boolean):[];\n    for(const key of ['vehicles','drivers','rideRequests','activeTrips','tripArchive','tripArchivePending','events','capitalCenters'])for(const row of m[key]){if(row.ownerCompanyId&&String(row.ownerCompanyId)!==ownerCompanyId)throw new Error(`mobility-row-owner-conflict:${key}:${row.id||'unknown'}`);row.ownerCompanyId=ownerCompanyId;}\n    m.status=m.vehicles.length?'active':'not-launched';\n    m.zones=clone(ZONES);m.sequence=Math.max(0,Number(m.sequence)||0);\n","    const ownerCompanyId=mobilityOwnerCompanyId(state,explicitOwner),kernel=globalThis.GH_KERNEL,tx=globalThis.GH_TRANSACTION_CORE;\n    const current=state.mobility,tracked=kernel?.isStateView?.(current)===true;\n    // Only kernel views have reliable mutation stamps. Raw legacy objects must\n    // be checked again, because callers can change them without the kernel.\n    if(tracked){const cached=normalizedMobility.get(current);if(cached?.owner===ownerCompanyId&&cached.stamp===kernel.stampOf(current))return current;}\n    const apply=()=>normalizeMobilityState(state,ownerCompanyId);\n    // Missing/legacy state is repaired as one owner transaction, never a series\n    // of partial writes from a presentation call. Nested calls join their owner.\n    let m;\n    if(tx?.isKernelOwner?.(state)===true&&!tx.isActive()){\n      const result=tx.execute(state,{label:'mobility:normalize',scope:['mobility'],apply});\n      if(!result.committed)throw new Error(result.reason||'mobility-normalization-rejected');\n      m=state.mobility;\n    }else m=apply();\n    if(kernel?.isStateView?.(m)===true)normalizedMobility.set(m,{owner:ownerCompanyId,stamp:kernel.stampOf(m)});\n    return m;\n  }\n  function normalizeMobilityState(state,ownerCompanyId){\n    if(!state.mobility||typeof state.mobility!=='object')state.mobility={};\n    // Assignment returns the caller's object, while the kernel stores a clone.\n    // Read the authoritative view back before populating a newly created root.\n    const m=state.mobility;\n    if(m.ownerCompanyId&&String(m.ownerCompanyId)!==ownerCompanyId)throw new Error('mobility-state-owner-conflict');if(m.ownerCompanyId!==ownerCompanyId)m.ownerCompanyId=ownerCompanyId;\n    if(m.schema!=='gh-mobility-v4')m.schema='gh-mobility-v4';if(m.version!==VERSION)m.version=VERSION;\n    for(const key of MOBILITY_ROW_KEYS){\n      const rows=m[key];if(!Array.isArray(rows)){m[key]=[];continue;}\n      // Do not replace canonical arrays (or allocate a copy) on every map frame.\n      for(let index=0;index<rows.length;index++)if(!rows[index]){m[key]=rows.filter(Boolean);break;}\n    }\n    for(const key of MOBILITY_ROW_KEYS)for(const row of m[key]){if(row.ownerCompanyId&&String(row.ownerCompanyId)!==ownerCompanyId)throw new Error(`mobility-row-owner-conflict:${key}:${row.id||'unknown'}`);if(row.ownerCompanyId!==ownerCompanyId)row.ownerCompanyId=ownerCompanyId;}\n    const status=m.vehicles.length?'active':'not-launched';if(m.status!==status)m.status=status;\n    if(JSON.stringify(m.zones)!==MOBILITY_ZONES_JSON)m.zones=clone(ZONES);const sequence=Math.max(0,Number(m.sequence)||0);if(m.sequence!==sequence)m.sequence=sequence;\n")
replace('WebApp/mobility-core.js',"    const legacyKpis=m.kpis||{};m.kpis={requests:0,accepted:0,completed:0,cancelled:0,grossBookings:0,driverPayouts:0,platformRevenue:0,avgRating:4.91,acceptanceRate:100,completionRate:100,...legacyKpis};\n    if(!Number.isFinite(Number(legacyKpis.accepted)))m.kpis.accepted=Math.max(Number(m.kpis.completed)||0,(Number(m.kpis.requests)||0)-(Number(m.kpis.cancelled)||0)-m.rideRequests.filter(request=>request.status==='queued').length);\n","    const legacyKpis=m.kpis||{},repairAccepted=!Number.isFinite(Number(legacyKpis.accepted));\n    if(!m.kpis||typeof m.kpis!=='object')m.kpis={...MOBILITY_KPI_DEFAULTS,...legacyKpis};\n    else for(const [key,value] of Object.entries(MOBILITY_KPI_DEFAULTS))if(!Object.prototype.hasOwnProperty.call(m.kpis,key))m.kpis[key]=value;\n    if(repairAccepted)m.kpis.accepted=Math.max(Number(m.kpis.completed)||0,(Number(m.kpis.requests)||0)-(Number(m.kpis.cancelled)||0)-m.rideRequests.filter(request=>request.status==='queued').length);\n")

if digest(ROOT/'WebApp/mobility-core.js')!='2ad85f60489a44a75423a75e4c7960f009be50ab443b0d99517271ee59645b9e':
    raise ValueError('Reviewed Mobility fix byte mismatch')
replace('WebApp/app.js',"const APP_VERSION = '3.0.2';","const APP_VERSION = '3.0.3';")
replace('WebApp/app.js','const RUNTIME_BUILD = 344;','const RUNTIME_BUILD = 345;')
replace('WebApp/advanced-core.js',"const VERSION = '3.0.2';","const VERSION = '3.0.3';")
replace('WebApp/control-plane-core.js',"const APP_VERSION='3.0.2';","const APP_VERSION='3.0.3';")
replace('iOS/GlobalHoldings/GlobalGameStorage.swift','as? String ?? "3.0.2"','as? String ?? "3.0.3"')
replace('tests/build339-architecture-bootstrap.cjs',"assert.equal(build,344,'Build 344 identity drifted');","assert.equal(build,345,'Build 345 identity drifted');")
replace('tests/build339-architecture-bootstrap.cjs',"assert.equal(read('VERSION').trim(),'3.0.2','VERSION drifted');","assert.equal(read('VERSION').trim(),'3.0.3','VERSION drifted');")
replace('tests/build339-architecture-bootstrap.cjs','`3.0.2-build${build}`','`3.0.3-build${build}`')
(ROOT/'VERSION').write_text(VERSION+'\n');(ROOT/'BUILD').write_text(str(BUILD)+'\n')
for key,old,new in [('MARKETING_VERSION','3.0.2',VERSION),('CFBundleShortVersionString','3.0.2',VERSION),('CURRENT_PROJECT_VERSION','344',str(BUILD)),('CFBundleVersion','344',str(BUILD))]:
    replace('project.yml',key+': "'+old+'"',key+': "'+new+'"')
pkg=json.loads((ROOT/'package.json').read_text());pkg['name']='global-holdings-build345-webapp';pkg['version']=VERSION+'-build345'
pkg['scripts']['test:build345']='node tests/build345-mobility-read-conflict.cjs'
pkg['scripts']['test']+=' && npm run test:build345'
write_json('package.json',pkg)
web_sha=tree_digest({n:r for n,r in inventory(ROOT).items() if n.startswith('WebApp/')})
p=ROOT/'project.yml';text=p.read_text();text,count=re.subn(r'(?m)^(\s*GHSourceSnapshotSHA256:) [a-f0-9]{64}$',r'\1 '+web_sha,text)
if count!=1:raise ValueError('Missing native WebApp binding')
p.write_text(text)
files=inventory(ROOT);source_sha=tree_digest(files)
write_json('RUNTIME_SOURCE_MANIFEST.json',{'build':BUILD,'version':VERSION,'save_schema':'2.0.0','files':files,'source_tree_sha256':source_sha,'webapp_tree_sha256':web_sha})
limits=[
 'Strict under-5-ms maximum and elimination of frame drops are NOT proven; resident Worker ownership and chunked Native saving remain open.',
 'Build345 fixes one reproduced read-induced time conflict; no physical iPhone test has been run.',
 'Full WebKit 1800-asset performance fixture previously failed route setup; do not treat source acceptance as full-device performance approval.',
 'Unsigned test IPA requires signing before installation. Production approval remains closed.'
]
tracking={'repository':'bdr-design/GlobalHoldings-iOS-Source','base_commit_sha':BASE,'base_branch':'fix/build344-frame-safety','branch':BRANCH,'mode':'direct_git_tracked_tree','normal_ci_uses_overlay':False,'current_candidate_source_tree_sha256':source_sha,'current_candidate_webapp_tree_sha256':web_sha}
write_json('RELEASE_GATE.json',{'approved':False,'blocking_issues':limits,'build':BUILD,'version':VERSION,'save_schema':'2.0.0','point':'Build345 time-conflict fix; frame work remains open','source_tree_sha256':source_sha,'webapp_tree_sha256':web_sha,'source_tracking':tracking,'phase_status':{'calendar_read_conflict':'LOCAL_REGRESSION_PASS_CI_PENDING','frame_max_under_5ms':'NOT_VERIFIED','physical_iphone':'NOT_TESTED'},'latest_direct_source_ci':{'status':'PENDING_BUILD345_CI','source_tree_sha256':source_sha,'ipa_built':False,'physical_device_tested':False}})
auth=json.loads((ROOT/'EXPERIMENTAL_BUILD_AUTHORIZATION.json').read_text())
auth.update({'authorized_at':'2026-09-28','build':BUILD,'version':VERSION,'save_schema':'2.0.0','test_build_authorized':True,'production_approved':False,'minimum_acceptance_gates':160,'purpose':'Fresh unsigned IPA of reviewed Mobility time-conflict fix with version/build increase.','user_request':'Give me an IPA and increase the version number.','source_rule':'Start from exact Build344 source; modify the original owner module and publish a Git source commit before building; no IPA input, no runtime overlay.','source_tracking':tracking,'source_tree_sha256':source_sha,'webapp_tree_sha256':web_sha,'known_limits':limits,'latest_current_source_ci':{'status':'PENDING_BUILD345_CI','source_tree_sha256':source_sha,'ipa_built':False,'physical_device_tested':False},'latest_unsigned_test_ipa_delivery':None})
write_json('EXPERIMENTAL_BUILD_AUTHORIZATION.json',auth)
write_json('BUILD345_TIME_FIX_VERIFICATION.json',{'report':'Build345 Mobility time-conflict fix; experimental candidate','build':BUILD,'version':VERSION,'save_schema':'2.0.0','release_approved':False,'base_build344_commit':BASE,'repository_branch':BRANCH,'source_tree_sha256':source_sha,'webapp_tree_sha256':web_sha,'changes':['Idempotent Mobility normalization preserves canonical arrays and KPI objects.','Only reliable kernel mutation stamps cache normalization; legacy objects are rechecked.','Missing state normalization is atomic and reads back the authoritative cloned kernel root.','App, settings, diagnostics and native bundle version raised to 3.0.3 / 345.'],'local_verification':{'read_queries_60_revision_delta_before':600,'read_queries_60_revision_delta_after':0,'focused_node_suites_passed':18,'prepared_slice_assets':900,'real_mutation_rejection':True,'finance_failure_full_rollback':True,'prior_local_chromium_calendar':'focused six-company day/rollback/save-reload PASS; not 900-asset full game'},'current_ci':'PENDING; actual logs and IPA report are separate artifacts bound to the source commit','performance_acceptance':{'target_max_stage_ms':5,'strict_max_under_5ms_verified':False,'physical_iphone_tested':False,'production_approved':False},'known_limits':limits})
(ROOT/'CURRENT_REVIEW_POINT_AR.md').write_text('# Build 345 / 3.0.3 — time-conflict fix\n\nBase source: `'+BASE+'`. Branch: `'+BRANCH+'`.\n\nThe reviewed original Mobility module no longer replaces unchanged arrays/KPIs from map reads. Actual changes still invalidate prepared work; finance rollback remains enabled. Save Schema stays 2.0.0.\n\nSource is committed before macOS checkout/build. The CI artifact records the exact tested commit, source fingerprints, test results and IPA hash. Production approval remains closed. Under-5-ms maximum and physical iPhone frame stability are NOT proven.\n',encoding='utf-8')
verify(ROOT)
tracked=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
paths={p for p in tracked if p and p!='SOURCE_INTEGRITY_SHA256.txt'}|{'BUILD345_TIME_FIX_VERIFICATION.json'}
for name in paths:
    p=ROOT/name
    if p.is_symlink() or not p.is_file():raise ValueError('Invalid tracked source: '+name)
(ROOT/'SOURCE_INTEGRITY_SHA256.txt').write_text(''.join(digest(ROOT/n)+'  '+n+'\n' for n in sorted(paths)),encoding='utf-8')
print(json.dumps({'prepared':True,'build':BUILD,'version':VERSION,'source_tree_sha256':source_sha,'webapp_tree_sha256':web_sha,'runtime_files':len(files),'checksums':len(paths)}))
