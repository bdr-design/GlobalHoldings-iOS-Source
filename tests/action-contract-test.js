const fs=require('fs');
const app=fs.readFileSync('WebApp/app.js','utf8');
const advanced=fs.readFileSync('WebApp/advanced-core.js','utf8');
const actions=[...new Set([...advanced.matchAll(/action\('([^']+)'/g)].map(m=>m[1]).concat([...advanced.matchAll(/data-gh-action="([a-z][a-z-]+)"/g)].map(m=>m[1])))];
const prefixHandled=id=>id.startsWith('facility-')||id.startsWith('company-');
const removedAssetActions=new Set(['asset-request-authorize','asset-request-reject','asset-request-retry','asset-request-retry-all','asset-request-ai-recommend','asset-request-create','asset-portfolio-authorize','asset-portfolio-reject','asset-portfolio-build']);
const missingActions=actions.filter(id=>!removedAssetActions.has(id)&&!prefixHandled(id)&&!advanced.includes(`id==='${id}'`));
if(missingActions.length)throw new Error(`Unbound institutional actions: ${missingActions.join(', ')}`);
if(app.includes('data-gh-action="asset-request-')||app.includes('data-gh-action="asset-portfolio-'))throw new Error('removed asset request actions remain live in app');

const opened=[...new Set([...`${app}\n${advanced}`.matchAll(/data-open=\\?"([A-Za-z]+)\\?"/g)].map(m=>m[1]))];
const panels=['leadershipHub','workspaceHub','peopleHub','actionCenter','companies','control','finance','governanceHub','systemHub','network','routes','globalRoute','companyFacilities','market','more','contracts','ma','labor','assets','assetMarket','expansion','invoices','news','settings','diagnostics','competitors','assetManage','assignRoute','ports','energy','bank','governance','insurance','research','esg','career','realism','intelligence','aiApprovals','programs','facilityManage','companyManage','treasury','audit','legal','procurement','cyber','safety','updates'];
const missingPanels=opened.filter(id=>!panels.includes(id));
if(missingPanels.length)throw new Error(`Buttons target unknown panels: ${missingPanels.join(', ')}`);
console.log(`Global Holdings action contract: PASS (${actions.length} institutional actions, ${opened.length} panel links)`);
