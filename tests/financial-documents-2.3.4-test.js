const fs=require('fs');
const assert=(x,m)=>{if(!x)throw new Error(m)};
const app=fs.readFileSync('WebApp/app.js','utf8');
const css=fs.readFileSync('WebApp/styles.css','utf8');
for(const token of ['financial-paper cheque-paper authority-inspired','financial-paper transfer-paper authority-inspired','financeDocumentIdentity','transferDirection','حوالة واردة','حوالة صادرة','تحويل داخلي','financial-watermark','authority-signatures financial-signatures'])assert(app.includes(token),`Missing modern financial document token: ${token}`);
for(const token of ['2.3.9 modern financial instruments','financial-subject','financial-amount','transfer-parties','transfer-flow-mark'])assert(css.includes(token),`Missing financial document style: ${token}`);
assert(!/function chequeArt\(c\).*?<div class="cheque-main">/s.test(app),'Legacy cheque-main rendering must not return');
assert(!/function transferArt\(x\).*?<div class="transfer-body">/s.test(app),'Legacy transfer-body rendering must not return');
console.log('Modern financial documents 2.3.9: PASS');
