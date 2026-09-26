'use strict';
const fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const root=process.env.GH_AUDIT_ROOT||path.resolve(__dirname,'../..');
const {drawFounderSignature}=require(path.join(root,'tests/helpers/signature-input'));
async function boot(options={}){
 const web=path.join(options.root||root,'WebApp'),browser=options.browser||await chromium.launch({headless:true}),page=await browser.newPage({viewport:options.viewport||{width:844,height:390}}),errors=options.errors||[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 let html=fs.readFileSync(path.join(web,'index.html'),'utf8');const scripts=[...html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/g)].map(m=>m[1]);
 html=html.replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/g,'');
 html=html.replace(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/g,(_,f)=>'<style>'+fs.readFileSync(path.join(web,f),'utf8')+'</style>');
 await page.setContent(html,{waitUntil:'domcontentloaded'});
 // Local in-memory persistence fixture; no navigations, network fetches or policy changes.
 await page.evaluate(initial=>{const storage=(entries=[])=>{const values=new Map(entries);return {get length(){return values.size},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(String(k))??null,setItem:(k,v)=>values.set(String(k),String(v)),removeItem:k=>values.delete(String(k)),clear:()=>values.clear()};};Object.defineProperty(window,'localStorage',{value:storage(initial)});Object.defineProperty(window,'sessionStorage',{value:storage()});},options.storage||[]);
 for(const file of scripts){let text=fs.readFileSync(path.join(web,file),'utf8');
  if(file==='app.js'){const i=text.lastIndexOf('})();');text=text.slice(0,i)+`\nwindow.__AUDIT__={injectAssetProcessor(fn){const original=processAssetDraft;processAssetDraft=fn;return ()=>{processAssetDraft=original;};},createSimulationSliceJob,simulationAssetGuard,simulationAssetSnapshot,simulationContextGuard,processAssetDraft,renderMap,updateMarkerPositions,animateMapMarkerPositions,presentationFrameInterval,presentationAssetLookup,replaceLiveState,runAuthorizedDomainCommand,runDurableStateCommand,save,buyAsset,showAsset,setSpeed,updateKpis,updateMapStatus,compactSimulationState,makeSimulationEffects,movingAssetRenderGroups,averageMapPoint,assetPosition,currentAssetRoute,prepareRoute,simulationEngine,routeTemplates,findFacility,openGlobalBase,openDrawer,closeDrawer,mapMetrics:()=>({layers:Object.keys(map._layers).length,ownMarkers:ownMarkers.size,motionStates:markerMotionStates.size,clusters:movingFleetClusters.size,individuals:renderedAssetIds.size,dom:document.querySelectorAll('*').length}),state:()=>state};\n`+text.slice(i);}
  await page.evaluate('(()=>{'+text+'\n})()');
 }
 if(options.found===false||process.env.GH_AUDIT_UNFORMED)return {page,browser,errors};
 if(!await page.evaluate(()=>window.__GH_STATE__?.onboardingComplete)){await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();await page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);}
 if(await page.evaluate(()=>__GH_STATE__.speed>0))await page.click('#speedToggle');
 return {page,browser,errors};
}
async function reboot(page,options={}){
 const storage=await page.evaluate(()=>Array.from({length:localStorage.length},(_,i)=>{const key=localStorage.key(i);return [key,localStorage.getItem(key)];}));
 const browser=page.context().browser();await page.close();return boot({...options,browser,storage});
}
module.exports={boot,reboot};
