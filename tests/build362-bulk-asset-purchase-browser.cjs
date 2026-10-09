'use strict';
// A public purchase may request up to one million records on Native, but the browser gate uses a small real order to
// prove the same path: bounded chunks, exact per-facility distribution, atomic rollback, and separate cheque registers.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390}});page.setDefaultTimeout(180000);
    const setup=await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,type='air',definition=GH_COMPANY_PLATFORM.definitionFor(s,type);s.godMoney=true;s.infiniteMoney=true;
      await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:900000000,legalName:'QA Bulk Assets',formationContract:'QA-BULK-ASSETS'},{silent:true});
      for(const icao of ['OMDB','EGLL']){const airport=GH_WORLD_DATA.airports.find(row=>row[0]===icao),id=`QA-${icao}`;await a.runAuthorizedDomainCommand('facilities','create',{facility:{id,name:`QA ${icao}`,kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:`air:${icao}`,code:airport[1]||icao,icao,iata:airport[1],city:airport[3]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]},bucket:'globalBases'},{silent:true});}
      a.openDrawer('assetMarket','air');const card=document.querySelector('.asset-market-card');
      return {max:Number(card?.querySelector('.manual-asset-qty')?.max),distribution:[...(card?.querySelector('.manual-asset-distribution')?.options||[])].map(row=>row.value)};
    });
    assert.deepEqual(setup,{max:1000000,distribution:['total','per-facility']});

    const purchased=await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,model=GH_ASSET_CATALOG.air.used[0],progress=[],total={progress:(done,count)=>progress.push([done,count])};
      const first=await a.buyAsset('air','used',model.id,'lease',600,'QA-OMDB',true,'QA-BULK-600','air',total);
      const each={distribution:'per-facility',progress:(done,count)=>progress.push([done,count])};
      const second=await a.buyAsset('air','used',model.id,'lease',10,'QA-OMDB',true,'QA-EACH-10','air',each);
      return {first,second,progress,total:{completed:total.completedCount,facilities:total.facilityCount,chunks:total.chunkCount},each:{completed:each.completedCount,facilities:each.facilityCount,chunks:each.chunkCount},size:GH_FLEET_DATA.size(s),byBase:Object.fromEntries(['QA-OMDB','QA-EGLL'].map(id=>[id,GH_FLEET_DATA.count(s,row=>row.baseFacility===id)]))};
    });
    assert.ok(purchased.first&&purchased.second);assert.deepEqual(purchased.total,{completed:600,facilities:1,chunks:2});assert.deepEqual(purchased.each,{completed:20,facilities:2,chunks:2});
    assert.deepEqual(purchased.byBase,{'QA-OMDB':610,'QA-EGLL':10});assert.equal(purchased.size,620);assert.deepEqual(purchased.progress,[[512,600],[600,600],[10,20],[20,20]]);

    const overLegacyCapacity=await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,model=GH_ASSET_CATALOG.air.used[0],progress=[],options={progress:(done,total)=>progress.push([done,total])};
      const order=await a.buyAsset('air','used',model.id,'lease',3500,'QA-OMDB',true,'QA-BULK-3500-SINGLE-BASE','air',options);
      return {order,completed:options.completedCount,facilities:options.facilityCount,chunks:options.chunkCount,progress,capacity:GH_FACILITY_CORE.assetCapacity(s.globalBases.find(row=>row.id==='QA-OMDB')),occupancy:GH_FACILITY_CORE.assetOccupancy(s,s.globalBases.find(row=>row.id==='QA-OMDB'))};
    });
    assert.ok(overLegacyCapacity.order,'one base accepts a real order above the previous 3,000-base limit');assert.equal(overLegacyCapacity.completed,3500);assert.equal(overLegacyCapacity.facilities,1);assert.equal(overLegacyCapacity.chunks,7);assert.equal(overLegacyCapacity.capacity,1000000);assert.equal(overLegacyCapacity.occupancy,4110);

    const rollback=await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,model=GH_ASSET_CATALOG.air.used[0],core=GH_PROCUREMENT_CORE,original=core.execute,snapshot=()=>JSON.stringify({fleet:GH_FLEET_DATA.size(s),deliveries:s.realism.procurement.deliveries.length,cheques:s.finance.cheques.length,invoices:s.finance.invoices.length,supplier:s.supplierTransactions.length,cash:GH_FINANCE_CORE.operating(s,'air')}),before=snapshot();let purchases=0;
      core.execute=function(ctx,cmd,payload){if(cmd==='purchase-assets'&&++purchases===2)throw new Error('QA-BULK-SECOND-CHUNK');return original.call(this,ctx,cmd,payload);};
      try{const options={};const order=await a.buyAsset('air','used',model.id,'lease',600,'QA-OMDB',true,'QA-BULK-ROLLBACK','air',options);return {order,error:options.errorMessage,identical:before===snapshot(),purchases};}finally{core.execute=original;}
    });
    assert.equal(rollback.order,null);assert.match(rollback.error,/QA-BULK-SECOND-CHUNK/);assert.equal(rollback.identical,true,'a later chunk failure rolls back payment, documents and every earlier asset');assert.equal(rollback.purchases,2);

    const chequeView=await page.evaluate(async()=>{
      const a=__AUDIT__,credit=(await a.runAuthorizedDomainCommand('finance','credit',{company:'air',amount:12500,note:'QA customer collection',counterparty:'QA Customer',reference:'QA-INCOMING',termsDays:7},{silent:true})).result;
      await a.runAuthorizedDomainCommand('finance','collect-receivables-by-cheque',{company:'air',numbers:[credit.number]},{silent:true});
      a.openDrawer('invoices',{company:'air',tab:'documents',view:'cheques'});
      return {headings:[...document.querySelectorAll('#drawerBody h3')].map(row=>row.textContent.trim()),text:document.querySelector('#drawerBody')?.textContent||'',incoming:__GH_STATE__.finance.cheques.filter(row=>row.direction==='incoming').length,outgoing:__GH_STATE__.finance.cheques.filter(row=>row.direction!=='incoming').length};
    });
    assert(chequeView.headings.includes('الشيكات الواردة'));assert(chequeView.headings.includes('الشيكات الصادرة'));assert.match(chequeView.text,/الشيكات الواردة/);assert.match(chequeView.text,/الشيكات الصادرة/);assert(chequeView.incoming>=1&&chequeView.outgoing>=1);
    await page.locator('#financeChequeDirection').selectOption('incoming');
    const incomingOnly=await page.evaluate(()=>({text:document.querySelector('#drawerBody')?.innerText||'',documents:document.querySelectorAll('#drawerBody .cheque-instrument').length,expected:__GH_STATE__.finance.cheques.filter(row=>row.direction==='incoming').length}));assert.match(incomingOnly.text,/الشيكات الواردة/);assert.equal(incomingOnly.documents,Math.min(80,incomingOnly.expected));
    await page.locator('#financeChequeDirection').selectOption('outgoing');
    const outgoingOnly=await page.evaluate(()=>({text:document.querySelector('#drawerBody')?.innerText||'',documents:document.querySelectorAll('#drawerBody .cheque-instrument').length,expected:__GH_STATE__.finance.cheques.filter(row=>row.direction!=='incoming').length}));assert.match(outgoingOnly.text,/الشيكات الصادرة/);assert.equal(outgoingOnly.documents,Math.min(80,outgoingOnly.expected));
    const tooMany=await page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__,model=GH_ASSET_CATALOG.air.used[0],before=GH_FLEET_DATA.size(s),options={},order=await a.buyAsset('air','used',model.id,'lease',1000001,'QA-OMDB',true,'QA-TOO-MANY','air',options);return {order,error:options.errorMessage,before,after:GH_FLEET_DATA.size(s)};});
    assert.equal(tooMany.order,null);assert.match(tooMany.error,/العدد يجب أن يكون/);assert.equal(tooMany.after,tooMany.before);
    assert.deepEqual(errors,[]);console.log(JSON.stringify({suite:'build362-bulk-asset-purchase-browser',setup,purchased,overLegacyCapacity,rollback,cheques:{incoming:chequeView.incoming,outgoing:chequeView.outgoing},tooMany}));console.log('BUILD362_BULK_ASSET_PURCHASE_BROWSER_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
