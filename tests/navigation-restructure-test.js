const fs=require('fs'),assert=require('assert');
const advanced=fs.readFileSync('WebApp/advanced-core.js','utf8'),app=fs.readFileSync('WebApp/app.js','utf8'),index=fs.readFileSync('WebApp/index.html','utf8');
for(const label of ['مركز القيادة التنفيذي','الأفراد والتنظيم','الحوكمة والمخاطر','النظام والصيانة','مساحات العمل'])assert(advanced.includes(label),`missing Build246 workspace ${label}`);
for(const label of ['الشبكة والبنية التحتية','القدرة والأصول','التجارة والتنفيذ'])assert(app.includes(label),`missing operations group ${label}`);
assert(!app.match(/renderControl\([\s\S]*?data-open=\?"labor/),'Operations Hub must not own HR navigation');
assert(index.includes('id="healthBtn"'),'health shortcut missing');assert(app.includes("openDrawer('diagnostics')"),'health shortcut binding missing');
console.log('Navigation restructure Build246: PASS');
