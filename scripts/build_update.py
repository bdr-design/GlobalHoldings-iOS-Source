#!/usr/bin/env python3
"""Build the Global Holdings clean full-web snapshot from repository source."""
from __future__ import annotations
import base64, hashlib, json
from update_signing import sign_manifest
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
WEB=ROOT/'WebApp'; UPDATES=ROOT/'updates'; VERSION='2.9.1'
ALLOWED={'.html','.js','.css','.webp','.png','.jpg','.jpeg','.json','.txt'}
OPERATIONS=[
  {'type':'content-config','value':{
    'visualPack':'GH Visual Library 2.0','catalogVersion':'2026.09.05-expanded','scenarioVersion':VERSION,
    'saveSchema':'2.0.0-idempotent-migration','architecture':'single-owner-cores-v2.2',
    'simulationClock':'simulation-core-2.2-single-time-owner','atomicTransactions':'transaction-core-2.2-all-or-nothing',
    'boundaryTransactions':'day-hour-finance-market-ai-inside-slice-commit','conflictPolicy':'reject-entire-slice-no-partial-eligible-commit',
    'lifecycleSafety':'visibility-cancel-persist-no-background-catchup','timeControls':'pause-x1-x2-x4',
    'assetDisposal':'return-to-owned-center-atomic-sale-v1','companyBudgets':'budget-actual-forecast-variance-v2',
    'assetRequestCenter':'manual-market-purchase-v1','aiAssetOrchestration':'ai-suggest-only-manual-dispatch-v1','mobilityIntegration':'live-map-trip-finance-hr-v2','investorTransfers':'treasury-journal-idempotent-v1','financialPaper':'local-security-art-v1','navigationIA':'unified-domain-names-height-safe-rail-v1','aiDemandClosure':'lifecycle-dependency-policy-event-ledger-v3','aiGovernance':'investment-committee-npv-irr-payback-v5','aiProactiveReview':'simulation-hour-supervised-v6',
    'procurementApproval':'atomic-delivery-clock-slice-cadence-v3','companyIdentity':'editable-live-name-logo-v2',
    'financialDocuments':'authority-inspired-cheques-transfers-v6','systemCompletion':'action-center-ui-quality-deterministic-business-ids-v3','workflowControl':'central-confirm-feedback-post-integrity-v1','financeIntegrity':'entity-ledger-account-document-invariants-v1','persistenceGateway':'validated-slots-native-vault-save-revision-v2','deterministicState':'sim-time-cache-and-sequence-identifiers-v1','corporateBank':'credit-trade-liquidity-v1',
    'bankRisk':'basel-cet1-rwa-lcr-nsfr-v3','economyEngine':'causal-correlated-deterministic-v2',
    'financialStatements':'entity-books-lease-rou-depreciation-consolidation-v2','integrityControls':'business-finance-domain-operational-invariants-v6','departmentLife':'state-driven-work-queues-management-escalation-v2'}},
  {'type':'economy-config','value':{'electricityPriceMWh':72,'gasCostMWh':39,'carbonPriceTon':52,'depositRate':0.032,'loanYield':0.075,'baseRate':0.046,'freightIndex':100,'engine':'realism-core-causal-v1'}},
  {'type':'visual-manifest','value':{'version':'2.2','fallbackPolicy':'sector-aware','categories':['air','sea','road','power','bank','headquarters','facilities']}}
]
def compact(v): return json.dumps(v,ensure_ascii=False,separators=(',',':')).encode()
def swift_json_compact(v):
    # Foundation JSONSerialization escapes forward slashes (\/). The native updater hashes that exact byte representation.
    return compact(v).replace(b'/', b'\\/')
def main():
    files=[]; total=0
    for source in sorted(p for p in WEB.rglob('*') if p.is_file() and p.suffix.lower() in ALLOWED):
        data=source.read_bytes(); total+=len(data)
        files.append({'path':source.relative_to(ROOT).as_posix(),'size':len(data),'sha256':hashlib.sha256(data).hexdigest(),'base64':base64.b64encode(data).decode('ascii')})
    manifest={'id':'gh-internal-2.9.1-build255-manual-asset-routing','name':'Global Holdings 2.9.1 — Manual Assets and Routing','version':VERSION,'minGameVersion':'2.9.0','packageType':'full-web','installMode':'clean-snapshot-v1','channel':'stable','signaturePayloadVersion':2,'createdAt':datetime.now(timezone.utc).isoformat(),'releaseNotes':'BUILD255: شراء الأصول يدوي، اقتراح المسارات بالذكاء الاصطناعي دون تنفيذ، تحريك جماعي بزر واحد، وأساطيل GH Mobility الحضرية المرتبطة بالمالية والموارد البشرية. Save Schema يبقى 2.0.0.','fileCount':len(files),'unpackedBytes':total,'operationsSha256':hashlib.sha256(compact(OPERATIONS)).hexdigest()}
    index=[[f['path'],f['sha256'],f['size']] for f in files]
    manifest['filesIndexSha256']=hashlib.sha256(swift_json_compact(index)).hexdigest()
    sign_manifest(manifest)
    package={'format':'global-holdings-update','manifest':manifest,'operationsJSON':compact(OPERATIONS).decode('utf-8'),'files':files,'version':VERSION,'id':manifest['id'],'name':manifest['name'],'operationsSha256':manifest['operationsSha256']}
    payload=json.dumps(package,ensure_ascii=False,separators=(',',':'))
    UPDATES.mkdir(exist_ok=True)
    for old in UPDATES.glob('GlobalHoldings_Update_V*.ghupdate'): old.unlink()
    for old in UPDATES.glob('GlobalHoldings_Update_V*.saneiupdate'): old.unlink()
    for ext in ('saneiupdate','ghupdate'):
        (UPDATES/f'GlobalHoldings_Internal_Update_V291_BUILD255_MANUAL_ASSET_ROUTING.{ext}').write_text(payload,encoding='utf-8')
    print(f'Built 2.9.1 Build255 manual asset/routing snapshot: {len(files)} files, {total:,} unpacked bytes')
if __name__=='__main__': main()
