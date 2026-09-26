'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {serve}=require('./helpers/web-server');
const {drawFounderSignature}=require('./helpers/signature-input');

const webApp=path.resolve(__dirname,'../WebApp');
const platformSource=path.join(webApp,'company-platform-core.js');

const HOTEL_DEFINITION={
  schema:'gh-company-definition/v1',
  id:'gh-hotels',
  definitionId:'gh-hotels-v1',
  definitionVersion:1,
  order:70,
  kind:'subsidiary',
  lifecycle:'active',
  instancePolicy:{mode:'multi',stateScope:'company'},
  identity:{
    legalDefault:{ar:'شركة فنادق جي إتش',en:'GH Hotels Company'},
    trade:{ar:'جي إتش للفنادق',en:'GH HOTELS'},
    short:'GH HOTELS',
    legacyLegalNames:[],
    marks:{
      default:'assets/identity/group-default.svg',
      symbol:'assets/identity/group-default.svg',
      horizontal:'assets/identity/group-default.svg',
      seal:'assets/identity/group-default.svg',
      mono:'assets/identity/group-default.svg'
    },
    palette:{accent:'#2d72df',secondary:'#0d3b57',route:'#2d72df',onAccent:'#ffffff'},
    hero:'assets/images/company-hq-v2.webp'
  },
  classification:{
    primarySectorId:'hospitality',
    sectorIds:['hospitality'],
    operationProfileId:'hospitality-operations-v1',
    assetClasses:[],
    routeModes:[]
  },
  capabilities:[
    'company.core','finance.book','finance.budget','finance.tax','hr.management',
    'documents.identity','documents.signature','map.company','conference.participant'
  ],
  founding:{
    defaultCapital:50000000,
    minimumCapital:10000000,
    legalForm:'شركة تابعة مملوكة للمجموعة',
    checklistIds:['commercial-registration'],
    documentPrefix:'HTL'
  },
  finance:{
    accountPrefix:'HTL',
    documentPrefix:'HTL',
    collectionProfileId:'hospitality-revenue-v1',
    currency:'USD',
    vatEnabled:true,
    internalBankEligible:true
  },
  hr:{managerRoleProfileId:'ceo-hospitality-v1',staffingProfileId:'hospitality-site-v1'},
  facilities:{
    directoryProviderIds:['world-capitals'],
    allowedKinds:['hotel'],
    primaryKind:'hotel',
    siteTemplate:{
      label:'فندق',
      facilityKind:'hotel',
      cost:6000000,
      dailyCost:9500,
      capacity:'220 غرفة',
      deliveryCapacity:0,
      photo:'assets/images/company-hq-v2.webp',
      iconKey:'hq',
      groupValueFactor:.72
    }
  },
  ui:{
    shell:'generic-company-v1',
    tabs:['overview','management','operations','people','finance'],
    extensions:[]
  },
  map:{layerProviderIds:['company-facilities'],filterGroup:'services',markerProfileId:'hotel'},
  conference:{providerId:'generic-company-v1',order:70},
  adapters:{
    lifecycle:'generic-company-v1',
    operations:'standard-company-operations-v1',
    finance:'standard-company-finance-v1',
    hr:'standard-company-hr-v1',
    facilities:'standard-company-facilities-v1',
    map:'company-map-v1',
    conference:'generic-company-v1',
    documents:'legal-documents-v1'
  },
  legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}
};

function stateSnapshot(){
  const state=globalThis.__GH_STATE__;
  const facilities=[...(state.globalBases||[]),...(state.customHubs||[])];
  const registry=Object.fromEntries(['air-one','air-two','gh-hotels'].map(id=>{
    const row=state.companyRegistry?.[id]||{};
    return [id,{definitionId:row.definitionId,legalName:row.legalName,shortName:row.shortName,status:row.status}];
  }));
  const finance=Object.fromEntries(['air-one','air-two','gh-hotels'].map(id=>{
    const book=state.companyFinance?.[id]||{};
    return [id,{accountId:book.accounts?.[0]?.id,balance:Number(book.accounts?.[0]?.balance)||0}];
  }));
  return {
    opened:['air-one','air-two','gh-hotels'].filter(id=>state.openedCompanies?.includes(id)),
    registry,
    finance,
    activeFilter:state.activeFilter,
    facilities:facilities.filter(row=>['air-one','air-two','gh-hotels'].includes(row.ownerCompanyId)).map(row=>({
      id:row.id,
      sourceKey:row.sourceKey,
      ownerCompanyId:row.ownerCompanyId,
      kind:row.kind,
      templateDefinitionId:row.templateDefinitionId||null,
      constructionContractId:row.constructionContractId||null
    })).sort((a,b)=>a.ownerCompanyId.localeCompare(b.ownerCompanyId)||a.id.localeCompare(b.id)),
    routes:(state.customRoutes||[]).filter(row=>['air-one','air-two'].includes(row.ownerCompanyId)).map(row=>({
      id:row.id,
      ownerCompanyId:row.ownerCompanyId,
      routeMode:row.routeMode,
      fromFacility:row.fromFacility,
      toFacility:row.toFacility,
      route:row.route
    })).sort((a,b)=>a.ownerCompanyId.localeCompare(b.ownerCompanyId)),
    hotelDefinition:globalThis.GH_COMPANY_PLATFORM.getDefinition('gh-hotels')?.definitionId||null,
    platformSealed:globalThis.GH_COMPANY_PLATFORM.isSealed()
  };
}

(async()=>{
  assert(fs.existsSync(platformSource),`missing platform source: ${platformSource}`);
  const server=await serve(webApp);
  const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:844,height:390},deviceScaleFactor:2,locale:'ar-SA'});
  const pageErrors=[],consoleDiagnostics=[];
  page.on('pageerror',error=>pageErrors.push(error.stack||error.message));
  page.on('console',message=>{if(['warning','error'].includes(message.type()))consoleDiagnostics.push(`${message.type()}: ${message.text()}`);});
  page.on('dialog',dialog=>dialog.accept());
  const transparentTile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+AvzZJwAAAABJRU5ErkJggg==','base64');
  await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,route=>route.fulfill({status:200,contentType:'image/png',headers:{'cache-control':'no-store'},body:transparentTile}));
  await page.route('**/company-platform-core.js',async route=>{
    const source=fs.readFileSync(platformSource,'utf8');
    const install=`\n;globalThis.GH_COMPANY_PLATFORM.installDefinition(${JSON.stringify(HOTEL_DEFINITION)},{source:'build334-browser-fixture'});\n`;
    await route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',headers:{'cache-control':'no-store'},body:source+install});
  });

  try{
    await page.goto(server.baseURL);
    await page.waitForFunction(()=>globalThis.GH_COMPANY_PLATFORM?.isSealed?.()===true);
    assert.equal(await page.evaluate(()=>GH_COMPANY_PLATFORM.getDefinition('gh-hotels')?.definitionId),'gh-hotels-v1','manifest-only definition must install before the runtime seal');
    await page.waitForFunction(()=>globalThis.__GH_STATE__&&document.querySelector('#founderFlow'));
    await page.waitForTimeout(250);
    const startup=await page.evaluate(()=>({onboardingComplete:__GH_STATE__.onboardingComplete,founderHidden:document.querySelector('#founderFlow').classList.contains('hidden'),founderDisplay:getComputedStyle(document.querySelector('#founderFlow')).display,bodyText:document.body.innerText.slice(0,500)}));
    assert.equal(startup.onboardingComplete,false,`browser fixture must start pristine: ${JSON.stringify(startup)}`);
    const sectorMetricFailure=pageErrors.find(error=>error.includes('finance-sector-profit-today-company-unknown:hospitality'));
    assert.equal(sectorMetricFailure,undefined,`manifest startup mixed a sector id into company-instance finance metrics; inspect GH_MIGRATION_CORE.completeBusinessState metricKeys: ${sectorMetricFailure||''}`);
    assert.deepEqual(pageErrors,[],`startup emitted an uncaught error: ${JSON.stringify(startup)}`);
    await page.locator('#founderFlow:not(.hidden)').waitFor({state:'visible'});

    await page.selectOption('#founderMode','sandbox');
    await page.click('#founderReview');
    await page.locator('#founderSignatureMount .authorization-pad-canvas').scrollIntoViewIfNeeded();
    await drawFounderSignature(page);
    await page.locator('#founderForm button[type=submit]').click();
    try{await page.waitForFunction(()=>globalThis.__GH_STATE__?.onboardingComplete===true,null,{timeout:10000});}
    catch(error){
      const founding=await page.evaluate(()=>({
        feedback:document.querySelector('#founderError')?.textContent?.trim()||'',
        feedbackHidden:document.querySelector('#founderError')?.hidden,
        ariaBusy:document.querySelector('#founderForm')?.getAttribute('aria-busy'),
        onboardingComplete:__GH_STATE__?.onboardingComplete,
        alerts:__GH_STATE__?.alerts?.slice?.(0,4)||[]
      }));
      throw new Error(`founding did not commit: ${JSON.stringify(founding)}; pageErrors=${JSON.stringify(pageErrors)}; console=${JSON.stringify(consoleDiagnostics)}; ${error.message}`);
    }

    await page.evaluate(()=>{
      __GH_STATE__.speed=0;
      const original=GH_INTERFACE.prepare;
      globalThis.GH_INTERFACE={...GH_INTERFACE,prepare(root,panel,arg,ctx){globalThis.qaContext=ctx;return original(root,panel,arg,ctx);}};
    });
    await page.locator('.side-nav [data-panel=companies]').click();
    await page.waitForFunction(()=>globalThis.qaContext?.runAuthorizedDomainCommand);

    await page.evaluate(async()=>{
      const companies=[
        {companyId:'air-one',definitionId:'gh-air-v1',capital:100000000,legalName:'شركة الأفق الأولى للطيران',shortName:'AIR ONE',formationContract:'QA-AIR-ONE-334'},
        {companyId:'air-two',definitionId:'gh-air-v1',capital:100000000,legalName:'شركة الأفق الثانية للطيران',shortName:'AIR TWO',formationContract:'QA-AIR-TWO-334'},
        {companyId:'gh-hotels',definitionId:'gh-hotels-v1',capital:50000000,legalName:'شركة فنادق جي إتش',shortName:'GH HOTELS',formationContract:'QA-HOTELS-334'}
      ];
      for(const payload of companies)await qaContext.runAuthorizedDomainCommand('corporate','open-company',payload);
    });
    await page.waitForFunction(()=>['air-one','air-two','gh-hotels'].every(id=>__GH_STATE__.openedCompanies.includes(id)));
    const instanceCheck=await page.evaluate(()=>({
      ids:GH_COMPANY_PLATFORM.listInstances(__GH_STATE__,{includeGroup:false,openedOnly:true}).filter(row=>row.operational).map(row=>row.id),
      definitions:['air-one','air-two','gh-hotels'].map(id=>GH_COMPANY_PLATFORM.definitionFor(__GH_STATE__,id)?.definitionId),
      accounts:['air-one','air-two','gh-hotels'].map(id=>__GH_STATE__.companyFinance[id]?.accounts?.[0]?.id)
    }));
    assert(instanceCheck.ids.includes('air-one')&&instanceCheck.ids.includes('air-two')&&instanceCheck.ids.includes('gh-hotels'),'all three companies must be live without a reload');
    assert.deepEqual(instanceCheck.definitions,['gh-air-v1','gh-air-v1','gh-hotels-v1']);
    assert.equal(new Set(instanceCheck.accounts).size,3,'each company instance must own a distinct finance account');

    await page.evaluate(()=>{
      const proto=L.Map.prototype;
      globalThis.qaMapSetViewCalls=[];
      globalThis.qaMapCameraBefore=null;
      globalThis.qaMapInstance=null;
      const originalSetView=proto.setView;
      const originalGetCenter=proto.getCenter;
      proto.setView=function(...args){
        qaMapSetViewCalls.push(args.map(value=>value&&typeof value==='object'&&'lat' in value?{lat:value.lat,lng:value.lng}:value));
        return originalSetView.apply(this,args);
      };
      proto.getCenter=function(...args){
        const center=originalGetCenter.apply(this,args);
        qaMapInstance=this;
        if(!qaMapCameraBefore)qaMapCameraBefore={lat:center.lat,lng:center.lng,zoom:this.getZoom()};
        return center;
      };
    });

    await page.locator('#filterToggle').click();
    await page.locator('#filterPopover:not(.hidden)').waitFor();
    assert.equal(await page.locator('#filterPopover [data-filter="air-one"]').count(),1,'air-one needs its own live filter');
    assert.equal(await page.locator('#filterPopover [data-filter="air-two"]').count(),1,'air-two needs its own live filter');
    assert.equal(await page.locator('#filterPopover [data-filter="gh-hotels"]').count(),1,'manifest-only company needs a live filter');
    assert.equal(await page.evaluate(()=>qaMapSetViewCalls.length),0,'opening filters must not move the camera');

    await page.locator('#filterPopover [data-filter="air-one"]').click();
    await page.waitForFunction(()=>__GH_STATE__.activeFilter==='air-one');
    assert.equal(await page.locator('#filterPopover [data-filter="air-one"]').getAttribute('aria-pressed'),'true');
    assert(await page.locator('#filterPopover [data-filter="air-one"]').evaluate(node=>node.classList.contains('active')));
    assert.equal(await page.locator('#filterPopover [data-filter="air-two"]').getAttribute('aria-pressed'),'false');
    assert.equal(await page.evaluate(()=>qaMapSetViewCalls.length),0,'selecting air-one must preserve the camera');

    await page.locator('#filterPopover [data-filter="air-two"]').click();
    await page.waitForFunction(()=>__GH_STATE__.activeFilter==='air-two');
    assert.equal(await page.locator('#filterPopover [data-filter="air-two"]').getAttribute('aria-pressed'),'true');
    assert(await page.locator('#filterPopover [data-filter="air-two"]').evaluate(node=>node.classList.contains('active')));
    const cameraCheck=await page.evaluate(()=>{
      const current=qaMapInstance?.getCenter?.();
      return {calls:qaMapSetViewCalls.length,before:qaMapCameraBefore,after:current?{lat:current.lat,lng:current.lng,zoom:qaMapInstance.getZoom()}:null};
    });
    assert.equal(cameraCheck.calls,0,'selecting a second same-definition company must not invoke setView');
    assert(cameraCheck.before&&cameraCheck.after,'map camera must be observable during filter selection');
    assert(Math.abs(cameraCheck.before.lat-cameraCheck.after.lat)<1e-9&&Math.abs(cameraCheck.before.lng-cameraCheck.after.lng)<1e-9&&cameraCheck.before.zoom===cameraCheck.after.zoom,'filter selection must preserve exact camera coordinates and zoom');

    await page.evaluate(()=>{
      const original=globalThis.GH_DOCUMENT_PROOF;
      const originalAuthorization=globalThis.GH_AUTHORIZATION;
      globalThis.qaDocumentProofDiagnostics=[];
      globalThis.qaAuthorizationDiagnostics=[];
      const unsupportedPaths=(value)=>{
        const found=[],active=new WeakSet();
        const visit=(current,path)=>{
          if(found.length>=40)return;
          if(current===undefined||typeof current==='function'||typeof current==='symbol'||typeof current==='bigint'){found.push(`${path}:${typeof current}`);return;}
          if(typeof current==='number'&&!Number.isFinite(current)){found.push(`${path}:non-finite`);return;}
          if(!current||typeof current!=='object')return;
          if(active.has(current)){found.push(`${path}:cycle`);return;}
          if(!Array.isArray(current)&&(Object.prototype.toString.call(current)!=='[object Object]'||Object.getOwnPropertySymbols(current).length)){found.push(`${path}:non-json-object`);return;}
          active.add(current);
          if(Array.isArray(current)){for(let index=0;index<current.length;index++)visit(current[index],`${path}[${index}]`);}
          else for(const key of Object.keys(current))visit(current[key],`${path}.${key}`);
          active.delete(current);
        };
        visit(value,'$');
        return found;
      };
      globalThis.GH_AUTHORIZATION=Object.freeze({...originalAuthorization,
        stable(value){try{return originalAuthorization.stable(value);}catch(error){qaAuthorizationDiagnostics.push({call:'stable',error:String(error?.stack||error),unsupported:unsupportedPaths(value)});throw error;}},
        digest(value){try{return originalAuthorization.digest(value);}catch(error){qaAuthorizationDiagnostics.push({call:'digest',error:String(error?.stack||error),unsupported:unsupportedPaths(value)});throw error;}},
        verifyProof(state,id){try{return originalAuthorization.verifyProof(state,id);}catch(error){const proof=state.authorization?.proofsById?.[id]||null;qaAuthorizationDiagnostics.push({call:'verifyProof',id,error:String(error?.stack||error),unsupported:unsupportedPaths(proof),proof});throw error;}}
      });
      const summarize=(value,depth=0)=>{
        if(depth>3)return '[depth-limit]';
        if(Array.isArray(value))return value.slice(0,8).map(item=>summarize(item,depth+1));
        if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,40).map(([key,item])=>[key,summarize(item,depth+1)]));
        return value;
      };
      const differentKeys=(before={},after={})=>[...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(key=>JSON.stringify(before?.[key])!==JSON.stringify(after?.[key]));
      const instrumented={...original,bindAuthorization(state,documents,proof){
        const rows=(Array.isArray(documents)?documents:[]).map(item=>{
          const document=item.document||original.locateDocument(state,item.proofId);
          const proofId=item.proofId||document?.documentProofId;
          const record=state.documentProofs?.recordsById?.[proofId];
          const verification=document?original.verifyDocument(state,document):{ok:false,reason:'document-missing'};
          let currentMaterial=null,materialError=null;
          try{currentMaterial=document?original.materialDetails(document,record?.documentType||document.documentType).payload:null;}
          catch(error){materialError=String(error?.stack||error);}
          const signedMaterial=record?.signedContent?.material?.payload||null;
          const diffKeys=currentMaterial&&signedMaterial?differentKeys(signedMaterial,currentMaterial):[];
          return {
            id:document?.id||document?.number||document?.reference||null,
            documentId:document?.documentId||record?.documentId||null,
            type:document?.documentType||record?.documentType||null,
            proofId,
            verification:{ok:verification?.ok===true,reason:verification?.reason||null},
            diffKeys,
            signedDiff:Object.fromEntries(diffKeys.map(key=>[key,summarize(signedMaterial?.[key])])),
            currentDiff:Object.fromEntries(diffKeys.map(key=>[key,summarize(currentMaterial?.[key])])),
            materialError
          };
        });
        try{
          const result=original.bindAuthorization(state,documents,proof);
          qaDocumentProofDiagnostics.push({ok:true,proofId:proof?.id||null,rows});
          return result;
        }catch(error){
          qaDocumentProofDiagnostics.push({ok:false,proofId:proof?.id||null,error:String(error?.stack||error),rows});
          throw error;
        }
      }};
      globalThis.GH_DOCUMENT_PROOF=Object.freeze(instrumented);
    });

    async function openFirstDirectorySite(company){
      await page.evaluate(id=>qaContext.openWorldDirectory(id),company);
      await page.waitForFunction(id=>document.querySelector('#worldKind')?.value===id,company);
      const button=page.locator(`.open-directory-site[data-company="${company}"]`).first();
      try{await button.waitFor({state:'visible'});}
      catch(error){
        const diagnostics=await page.evaluate(owner=>{
          const index=GH_DIRECTORY_CORE.create({airports:GH_WORLD_DATA?.airports||[],ports:GH_WORLD_DATA?.ports||[],capitals:GH_MOBILITY_CORE?.CAPITALS||[]});
          const rows=index.search({state:__GH_STATE__,company:owner,pageSize:3}).rows;
          return {
            owner,
            definition:GH_COMPANY_PLATFORM.definitionFor(__GH_STATE__,owner),
            instance:GH_COMPANY_PLATFORM.resolveCompany(__GH_STATE__,owner),
            selected:document.querySelector('#worldKind')?.value||null,
            projectedRows:rows.map(row=>({key:row.key,sourceProviderKey:row.sourceProviderKey,provider:row.provider,company:row.company})),
            keyResolution:rows.map(row=>({key:Boolean(qaContext.worldEntityByKey(row.key)),sourceProviderKey:Boolean(qaContext.worldEntityByKey(row.sourceProviderKey))})),
            renderedCards:[...document.querySelectorAll('.world-result')].slice(0,4).map(node=>({company:node.dataset.company,key:node.dataset.key})),
            empty:document.querySelector('.world-results-grid .empty')?.textContent?.trim()||null
          };
        },company);
        throw new Error(`directory did not render a facility action: ${JSON.stringify(diagnostics)}; ${error.message}`);
      }
      const key=await button.getAttribute('data-key');
      assert(key,`directory key missing for ${company}`);
      await button.click();
      try{await page.waitForFunction(([owner,sourceKey])=>[...(__GH_STATE__.globalBases||[]),...(__GH_STATE__.customHubs||[])].some(row=>row.ownerCompanyId===owner&&row.sourceKey===sourceKey),[company,key],{timeout:10000});}
      catch(error){
        const diagnostics=await page.evaluate(([owner,sourceKey])=>({
          owner,
          sourceKey,
          account:__GH_STATE__.companyFinance?.[owner]?.accounts?.[0]||null,
          bases:(__GH_STATE__.globalBases||[]).filter(row=>row.ownerCompanyId===owner),
          hubs:(__GH_STATE__.customHubs||[]).filter(row=>row.ownerCompanyId===owner),
          alerts:(__GH_STATE__.alerts||[]).slice(0,6),
          failures:GH_DOMAIN_COMMANDS.failures?.().slice(0,6)||[],
          documentProofDiagnostics:(globalThis.qaDocumentProofDiagnostics||[]).slice(-12),
          authorizationDiagnostics:(globalThis.qaAuthorizationDiagnostics||[]).slice(-12)
        }),[company,key]);
        throw new Error(`facility did not commit: ${JSON.stringify(diagnostics)}; pageErrors=${JSON.stringify(pageErrors)}; console=${JSON.stringify(consoleDiagnostics)}; ${error.message}`);
      }
      return key;
    }

    const airOneSite=await openFirstDirectorySite('air-one');
    const airTwoSite=await openFirstDirectorySite('air-two');
    assert.equal(airTwoSite,airOneSite,'both air instances must be able to select the same provider site');
    const hotelSite=await openFirstDirectorySite('gh-hotels');
    assert.match(hotelSite,/^site:gh-hotels:/,'hotel facility must come from the generic capital-directory projection');

    const facilityCheck=await page.evaluate(sourceKey=>{
      const all=[...(__GH_STATE__.globalBases||[]),...(__GH_STATE__.customHubs||[])];
      return {
        shared:all.filter(row=>row.sourceKey===sourceKey).map(row=>({owner:row.ownerCompanyId,id:row.id,kind:row.kind})).sort((a,b)=>a.owner.localeCompare(b.owner)),
        hotel:all.find(row=>row.ownerCompanyId==='gh-hotels')||null
      };
    },airOneSite);
    assert.deepEqual(facilityCheck.shared.map(row=>row.owner),['air-one','air-two'],'the shared airport must produce two owner-isolated facilities');
    assert.notEqual(facilityCheck.shared[0].id,facilityCheck.shared[1].id,'owner-isolated facilities must have distinct canonical ids');
    assert.equal(facilityCheck.shared[0].kind,'airport-base');
    assert.equal(facilityCheck.shared[1].kind,'airport-base');
    assert.equal(facilityCheck.hotel.ownerCompanyId,'gh-hotels');
    assert.equal(facilityCheck.hotel.kind,'hotel');
    assert.equal(facilityCheck.hotel.templateDefinitionId,'gh-hotels-v1','generic facility must retain its manifest provenance');
    assert(facilityCheck.hotel.constructionContractId,'generic facility must be backed by a construction contract');

    const routeGeometry=[[24.7136,46.6753],[25.2048,55.2708]];
    await page.evaluate(async geometry=>{
      const bases=Object.fromEntries((__GH_STATE__.globalBases||[]).filter(row=>['air-one','air-two'].includes(row.ownerCompanyId)).map(row=>[row.ownerCompanyId,row]));
      for(const [owner,id] of [['air-one','QA-AIR-ONE-R1'],['air-two','QA-AIR-TWO-R1']]){
        const base=bases[owner];
        if(!base)throw new Error(`base-missing:${owner}`);
        await qaContext.runAuthorizedDomainCommand('routes','create',{route:{
          id,
          ownerCompanyId:owner,
          routeMode:'air',
          name:`${owner} shared corridor`,
          fromFacility:base.id,
          toFacility:`REMOTE-${owner}`,
          from:base.name,
          to:'محطة اختبار مشتركة',
          route:geometry,
          distanceKm:900,
          tripSeconds:5400,
          dwellHours:2
        }},{silent:true});
      }
    },routeGeometry);
    const routes=await page.evaluate(()=>__GH_STATE__.customRoutes.filter(row=>row.id.startsWith('QA-AIR-')).map(row=>({id:row.id,owner:row.ownerCompanyId,mode:row.routeMode,route:row.route})));
    assert.equal(routes.length,2,'same geometry must be admitted once per explicit owner');
    assert.deepEqual(routes.map(row=>row.owner).sort(),['air-one','air-two']);
    assert(routes.every(row=>row.mode==='air'));
    assert.deepEqual(routes[0].route,routes[1].route,'route owner isolation must not depend on changing geometry');

    assert.equal(await page.evaluate(()=>qaContext.save()),true,'final explicit save must succeed');
    const beforeReload=await page.evaluate(stateSnapshot);
    await page.reload();
    await page.waitForFunction(()=>globalThis.__GH_STATE__?.onboardingComplete===true&&globalThis.GH_COMPANY_PLATFORM?.isSealed?.()===true);
    const afterReload=await page.evaluate(stateSnapshot);
    assert.deepEqual(afterReload,beforeReload,'company instances, owner-isolated facilities/routes, active filter, and manifest definition must survive reload');

    await page.locator('#filterToggle').click();
    await page.locator('#filterPopover:not(.hidden)').waitFor();
    for(const id of ['air-one','air-two','gh-hotels'])assert.equal(await page.locator(`#filterPopover [data-filter="${id}"]`).count(),1,`${id} filter must be rebuilt after reload`);
    assert.equal(await page.locator('#filterPopover [data-filter="air-two"]').getAttribute('aria-pressed'),'true','saved active company filter must restore its accessibility state');
    assert(await page.locator('#filterPopover [data-filter="air-two"]').evaluate(node=>node.classList.contains('active')),'saved active company filter must restore its visual state');
    assert.deepEqual(pageErrors,[],'browser runtime must not emit uncaught errors');
    assert.deepEqual(consoleDiagnostics,[],'browser runtime must not emit startup or transaction warnings/errors');

    console.log(JSON.stringify({
      passed:true,
      liveCompanies:instanceCheck.ids.filter(id=>['air-one','air-two','gh-hotels'].includes(id)),
      sharedProviderSite:airOneSite,
      ownerIsolatedFacilities:facilityCheck.shared.map(row=>row.owner),
      genericHotelFacility:facilityCheck.hotel.id,
      ownerIsolatedRoutes:routes.map(row=>row.owner),
      cameraPreserved:true,
      saveReload:true,
      pageErrors,
      consoleDiagnostics
    }));
  }finally{
    await browser.close();
    await server.close();
  }
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
