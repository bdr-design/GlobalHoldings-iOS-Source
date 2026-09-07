const fs=require('fs');
const app=fs.readFileSync('WebApp/app.js','utf8');
const advanced=fs.readFileSync('WebApp/advanced-core.js','utf8');
const actions=[...new Set([...advanced.matchAll(/action\('([^']+)'/g)].map(m=>m[1]).concat([...advanced.matchAll(/data-gh-action="([a-z][a-z-]+)"/g)].map(m=>m[1])))];
const prefixHandled=id=>id.startsWith('facility-')||id.startsWith('company-');
const missingActions=actions.filter(id=>!prefixHandled(id)&&!advanced.includes(`id==='${id}'`));
if(missingActions.length)throw new Error(`Unbound institutional actions: ${missingActions.join(', ')}`);

const opened=[...new Set([...`${app}\n${advanced}`.matchAll(/data-open=\\?"([A-Za-z]+)\\?"/g)].map(m=>m[1]))];
const panels=['leadershipHub','workspaceHub','peopleHub','actionCenter','companies','control','finance','governanceHub','systemHub','network','routes','globalRoute','market','more','contracts','ma','labor','assets','expansion','invoices','news','settings','diagnostics','competitors','assetManage','assignRoute','ports','energy','bank','governance','insurance','research','esg','career','realism','intelligence','aiApprovals','programs','facilityManage','companyManage','treasury','audit','legal','procurement','cyber','safety','updates'];
const missingPanels=opened.filter(id=>!panels.includes(id));
if(missingPanels.length)throw new Error(`Buttons target unknown panels: ${missingPanels.join(', ')}`);
console.log(`Global Holdings action contract: PASS (${actions.length} institutional actions, ${opened.length} panel links)`);
