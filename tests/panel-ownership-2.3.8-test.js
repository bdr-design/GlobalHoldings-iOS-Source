const fs=require('fs'),vm=require('vm'),assert=require('assert');
const adv=fs.readFileSync('WebApp/advanced-core.js','utf8');
const sandbox={window:{},globalThis:null,module:{exports:{}},console};sandbox.globalThis=sandbox.window;vm.createContext(sandbox);vm.runInContext(fs.readFileSync('WebApp/ui-quality-core.js','utf8'),sandbox);
const core=sandbox.window.GH_UI_QUALITY;assert(core&&core.VERSION==='2.9.1');
const match=adv.match(/const map=\{([\s\S]*?)\};\n    return map/);assert(match,'advanced panel map not found');
const keys=[...match[1].matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*:/g)].map(m=>m[1]);
const missing=keys.filter(k=>!core.PANEL_DOMAIN[k]);assert.deepStrictEqual(missing,[],`panels without domain owner: ${missing.join(', ')}`);
console.log(`Panel ownership 2.3.9: PASS (${keys.length} panels)`);
