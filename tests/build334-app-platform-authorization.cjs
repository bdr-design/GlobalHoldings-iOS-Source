'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'WebApp/app.js'),'utf8');
const lifecycle=fs.readFileSync(path.join(root,'WebApp/game-lifecycle-core.js'),'utf8');
const finance=fs.readFileSync(path.join(root,'WebApp/finance-core.js'),'utf8');
const build=fs.readFileSync(path.join(root,'BUILD'),'utf8').trim();

assert(app.includes(`const RUNTIME_BUILD = ${build};`),`app runtime build must match source BUILD ${build}`);
assert.doesNotMatch(app,/GH_DOMAIN_COMMANDS\.dispatch\(/,'app UI must not bypass the authorized/system gateways');
assert.match(app,/GH_DOMAIN_COMMANDS\.dispatchDurable\(/,'player commands must wait for durable persistence');
assert.match(app,/GH_DOMAIN_COMMANDS\.dispatchSystem\(/,'registered schedulers must use the closed system gateway');
assert.match(app,/sealSecurityPolicy\(\)/);
assert.match(app,/const FOUNDER_PRINCIPAL_ID='PLAYER-FOUNDER'/);
assert(app.indexOf("const FOUNDER_PRINCIPAL_ID='PLAYER-FOUNDER'")<app.indexOf('dedupeCustomRoutes()'),'founder authority constants must initialize before startup maintenance can request a system envelope');
assert.match(app,/validateVisualSeal\?\.\(authority\.signature\)/,'active founder seals must be structurally validated');
assert.match(app,/commandOptions\.authority=\{principalId:FOUNDER_PRINCIPAL_ID/,'delegated documents must explicitly request the founder principal');
assert.match(app,/pendingAuthorizedResumeSpeed/);
assert.match(app,/state\.speed=0;setTimeout\(\(\)=>\{openSignatureDialog\(\{required:true\}\)/,'legacy saves without a founder seal must pause before schedulers start');

assert.match(app,/listInstances\(state,\{includeGroup:false,openedOnly:true\}\)/,'map/company UI must be instance-derived');
assert.doesNotMatch(app,/\bCOMPANY_(?:FINANCE_)?TYPES\b/,'company consumers must not capture startup-only arrays');
assert.match(app,/function companyTypes\(target=state,options=\{\}\)/);
assert.match(app,/function companyFinanceTypes\(target=state,options=\{\}\)/);
assert.match(app,/button\.dataset\.filter=company\.id/);
assert.match(app,/button\.setAttribute\('aria-pressed',String\(selected\)\)/,'filter sync must restore visual and accessibility selection state');
assert.match(app,/const camera=map\?\{center:map\.getCenter\(\),zoom:map\.getZoom\(\)\}:null/);
assert.match(app,/map\.setView\(camera\.center,camera\.zoom,\{animate:false\}\)/,'changing a filter must restore the exact camera');
const filterToggleHandler=app.match(/\$\('filterToggle'\)\.addEventListener\('click',[^;]+;/)?.[0]||'';
assert.doesNotMatch(filterToggleHandler,/setView|fitBounds|panTo/,'opening the filter popover must not move the camera');

assert.match(app,/assetOwnerCompanyId\(asset\)===company\.id/,'owned asset UI must isolate company instances');
assert.match(app,/routeOwnerCompanyId\(route\)===companyId/,'route UI must isolate same-mode company instances');
assert.match(app,/contractDailyRows\.filter\(row=>row\.companyId===companyId\)/,'daily contract close must use explicit company ownership');
assert.match(app,/const closedSectorProfit=Object\.fromEntries\(companyIds\.map/,'daily close must be company-instance keyed');
assert.match(app,/for\(const company of companyIds\.filter\(companyId=>companyHasCapability\(state,companyId,'operations\.fleet'\)\)\)/,'payroll must enumerate fleet capabilities dynamically');
assert.doesNotMatch(app,/for\(const type of \['air','sea','road','mobility'\]\)/);
assert.doesNotMatch(app,/const sectorContractRevenue=\{air:/);
assert.doesNotMatch(app,/route\.company\s*=\s*route\.type/);
assert.match(app,/search\(\{state,company:worldKind/,'directory queries must resolve instance definitions against live state');
assert.match(app,/statsFor\(state,company\)/,'facility statistics must be instance-derived');
assert.match(app,/async function openGenericFacilitySite/);
assert.match(app,/dispatch\('facilities','create'/);
assert.match(app,/ensureFacilityWorkforceDraft\(draft,dispatch,company/);
assert.match(app,/await openDirectorySite\(/,'facility UI must remain busy until the durable command completes');
assert.doesNotMatch(app,/entity\.kind==='airport'\?'air':'sea'/,'airport/port providers must not fall back to canonical company ids');
assert.doesNotMatch(app,/data-markettype="air"/,'asset market tabs must be live registry projections');
assert.match(app,/function companyAssetClassForMode\(target,companyId,assetMode,requestedAssetClass=''/,'asset compatibility must be resolved against the selected company definition');
assert.match(app,/classification\?\.routeModes\|\|\[\]\),\.\.\.\(company\.definition\?\.legacy\?\.assetOwnerModes\|\|\[\]\)/,'modern route modes and legacy aliases must be unioned rather than short-circuited by an empty array');
assert.match(app,/isAssetFacilityCompatible\?\.\(\{assetMode:type,ownerCompanyId:owner,assetClass:resolvedClass\},f,target\)/,'base compatibility must carry the selected owner and asset class');
assert.match(app,/isAssetFacilityCompatible\?\.\(\{assetMode:type,ownerCompanyId,assetClass\},base,state\)/,'purchase validation must use the same owner-scoped facility contract');
assert.doesNotMatch(app,/isAssetFacilityCompatible\?\.\(type,base\)/,'asset purchase must never resolve a same-mode company through a canonical legacy owner');
assert.match(app,/FACILITY_SVG\[filter\]/,'world infrastructure markers must use vectors');
assert.doesNotMatch(app,/html:`<span>\$\{entity\.icon\}<\/span>`/,'world map markers must not render emoji glyphs');

assert.match(finance,/activeExecutionMeta\?\.authority\?\.principalId/,'system document authorization must require an explicit principal');
assert.match(finance,/findDelegatedAuthorization\?\.\(s,\{domain:'finance',name:activeExecutionMeta\.name\|\|'document',companyId,principalId/,'finance must constrain delegated seal lookup to the requested principal');

for(const renderer of ['chequeArt','invoiceArt','transferArt','payrollArt','taxSettlementArt','debtSettlementArt','renderProfitFlow']){
  const start=app.indexOf(`function ${renderer}`),next=app.indexOf('\n  function ',start+12),body=app.slice(start,next<0?app.length:next);
  assert(start>=0,`${renderer} renderer missing`);
  assert.match(body,/authorizationSignatureMarkup\(/,`${renderer} must render a visual seal or an explicit legacy/delegated marker`);
}
assert.match(app,/آلي بموجب التفويض — لا يُستخدم اسم نصي كتوقيع/);
assert.doesNotMatch(app,/esc\(signatory\)/,'new financial renderers must not use a typed name as a signature');

assert.match(lifecycle,/FOUNDING_GOVERNANCE/);
assert.match(lifecycle,/prepareFormationPlan/);
assert.match(lifecycle,/FOUNDING_SIGNATURE_REQUIRED/);
assert.match(lifecycle,/GH_FORMATION_ENGINE/);
assert.match(lifecycle,/helpers\.dispatchAuthorized/);
assert.match(lifecycle,/authorizationProofIds/);
assert.match(lifecycle,/signatureSnapshot/);

console.log('PASS Build 334 app platform ownership, camera-stable filters, founder authorization, dynamic close/payroll, and document seal contract');
