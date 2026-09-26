'use strict';
// ISOLATED COMPONENT TEST, NOT full-application acceptance or a save-upgrade test.
// Uses the original tabs() encoder/renderer and original app.js click bindings.
// A routing observer records calls; it is not the application's openDrawer owner.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'WebApp/advanced-core.js'),'utf8'),app=fs.readFileSync(path.join(root,'WebApp/app.js'),'utf8');
const encoder=source.match(/^  const text=.*;$/m)?.[0],renderer=source.match(/^  const tabs = .*;$/m)?.[0],registry=source.match(/^  const TAB_ATTRIBUTES=.*;$/m)?.[0]||'';
assert(encoder&&renderer);
const groups=[{panel:'companies',attribute:'data-companytab',call:source.match(/const tabbar=(tabs\(\[\['holding'[^\n]*?'data-companytab'\));/)?.[1]},
 {panel:'labor',attribute:'data-labortab',call:source.match(/const bar=(tabs\(\[\['dashboard'[^\n]*?'data-labortab'\));/)?.[1]}];
for(const g of groups){assert(g.call);g.binding=app.split('\n').find(line=>line.includes(`querySelectorAll('[${g.attribute}]')`));assert(g.binding);}
(async()=>{
 const b=await chromium.launch({headless:true}),rows=[];
 try{
  for(const viewport of [{width:844,height:390},{width:390,height:844}]){
   const p=await b.newPage({viewport,hasTouch:true,deviceScaleFactor:2});
   for(const g of groups){
    await p.setContent('<!doctype html><html dir="rtl" lang="ar"><body><main id="fixture"></main></body></html>');
    const items=await p.evaluate(({encoder,renderer,registry,g})=>{
     const code=`${encoder}\n${registry}\n${renderer}\nconst tab='';return ${g.call};`;
     document.querySelector('#fixture').innerHTML=new Function(code)();
     window.observedRoutes=[];window.openDrawer=(panel,arg)=>window.observedRoutes.push({panel,arg});
     new Function(g.binding)();
     return [...document.querySelectorAll('button')].map(button=>({label:button.textContent,id:button.getAttribute(g.attribute),attributes:button.getAttributeNames()}));
    },{encoder,renderer,registry,g});
    for(const item of items){
     const button=p.getByRole('button',{name:item.label,exact:true});
     if(viewport.width<viewport.height)await button.tap();else await button.click();
    }
    const calls=await p.evaluate(()=>window.observedRoutes);
    const ok=items.every(item=>typeof item.id==='string')&&calls.length===items.length&&calls.every((call,i)=>call.panel===g.panel&&call.arg===items[i].id);
    rows.push({panel:g.panel,viewport,input:viewport.width<viewport.height?'touch':'mouse',buttonCount:items.length,routeCalls:calls.length,ok,items,calls});
   }
   await p.close();
  }
  const result={scope:'isolated original tab renderer + original click bindings; no full app, storage, upgrade or iPhone execution',browser:b.version(),rows,passed:rows.every(row=>row.ok)};
  fs.writeFileSync(path.join(root,'verification/334-tabs-component-results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));assert.equal(result.passed,true,'a registered tab did not reach its original click binding');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
