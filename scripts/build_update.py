#!/usr/bin/env python3
"""Build the Global Holdings clean full-web snapshot from repository source."""
from __future__ import annotations
import base64, hashlib, json, os
from update_signing import sign_manifest
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
WEB=ROOT/'WebApp'; UPDATES=Path(os.environ.get('GH_UPDATE_OUTPUT_DIR',ROOT/'updates'))
VERSION=(ROOT/'VERSION').read_text(encoding='utf-8').strip()
BUILD=int((ROOT/'BUILD').read_text(encoding='utf-8').strip())
MIN_GAME_VERSION='2.9.1'
ALLOWED={'.html','.js','.css','.webp','.png','.jpg','.jpeg','.json','.txt'}
OPERATIONS=[
  {'type':'content-config','value':{
    'visualPack':'GH Visual Library 2.0','catalogVersion':'2026.09.05-expanded','scenarioVersion':VERSION,
    'saveSchema':'2.0.0-idempotent-migration','architecture':'single-owner-cores-v2.2',
    'simulationClock':'simulation-core-2.2-single-time-owner','atomicTransactions':'transaction-core-2.2-all-or-nothing',
    'boundaryTransactions':'day-hour-finance-market-ai-inside-slice-commit','conflictPolicy':'reject-entire-slice-no-partial-eligible-commit',
    'lifecycleSafety':'visibility-cancel-persist-no-background-catchup','timeControls':'pause-x1-x2-x4',
    'assetDisposal':'return-to-owned-center-atomic-sale-v1','companyBudgets':'budget-actual-forecast-variance-v2',
    'assetRequestCenter':'manual-market-purchase-v2','aiAssetOrchestration':'advisor-only-zero-execution-v1','mobilityIntegration':'manual-purchase-live-map-fixed-driver-v3','investorTransfers':'treasury-journal-idempotent-v1','financialPaper':'local-security-art-v1','navigationIA':'consolidated-command-and-owned-assets-v2','aiDemandClosure':'disabled-no-operational-handoff-v1','aiGovernance':'no-execution-authority-v1','aiProactiveReview':'disabled-v1',
    'procurementApproval':'atomic-immediate-base-delivery-v4','companyIdentity':'editable-live-name-logo-v2',
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
    manifest={'id':f'gh-internal-{VERSION}-build{BUILD}-clean-release','name':f'Global Holdings {VERSION} - BUILD{BUILD} Clean Release','version':VERSION,'minGameVersion':MIN_GAME_VERSION,'packageType':'full-web','installMode':'clean-snapshot-v1','channel':'stable','signaturePayloadVersion':2,'createdAt':datetime.now(timezone.utc).isoformat(),'releaseNotes':f'BUILD{BUILD}: توحيد الأصول والتشغيل. تبدأ الشركات بلا أصول مجانية، ويصل الأصل المشترى فورًا إلى قاعدته مع طاقم ثابت ورواتب آلية. أضيف تقرير رواتب اليوم 27 والإرسال الدولي بضغطة واحدة، وأعيد بناء الدليل العالمي والوصول للأصول والخريطة. AI مستشار محدود بلا تنفيذ أو تعطيل. الحزمة Full Web Clean Snapshot موقعة، وSave Schema يبقى 2.0.0.',
    'fileCount':len(files),'unpackedBytes':total,'operationsSha256':hashlib.sha256(compact(OPERATIONS)).hexdigest()}
    index=[[f['path'],f['sha256'],f['size']] for f in files]
    manifest['filesIndexSha256']=hashlib.sha256(swift_json_compact(index)).hexdigest()
    sign_manifest(manifest)
    package={'format':'global-holdings-update','manifest':manifest,'operationsJSON':compact(OPERATIONS).decode('utf-8'),'files':files,'version':VERSION,'id':manifest['id'],'name':manifest['name'],'operationsSha256':manifest['operationsSha256']}
    payload=json.dumps(package,ensure_ascii=False,separators=(',',':'))
    UPDATES.mkdir(exist_ok=True)
    for pattern in ('*.ghupdate','*.saneiupdate'):
        for old in UPDATES.glob(pattern): old.unlink()
    version_tag=VERSION.replace('.','')
    for ext in ('saneiupdate','ghupdate'):
        (UPDATES/f'GlobalHoldings_Internal_Update_V{version_tag}_BUILD{BUILD}_CLEAN_RELEASE.{ext}').write_text(payload,encoding='utf-8')
    print(f'Built {VERSION} BUILD{BUILD} clean signed snapshot: {len(files)} files, {total:,} unpacked bytes')
if __name__=='__main__': main()
