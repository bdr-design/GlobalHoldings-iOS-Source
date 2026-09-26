(()=>{'use strict';
const VERSION='1.0.0',SCHEMA='gh-formation-plan-v1',ALLOWED_ENTITY_KINDS=new Set(['group','company']);
const FORBIDDEN_EFFECTS=new Set(['grant-asset','grant-assets','grant-facility','grant-facilities','seed-fleet','seed-route','credit-unfunded']);
const clone=value=>value===undefined?undefined:(globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value)));
const deepFreeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);}return value;};
const clean=(value,max=180)=>{const text=String(value??'').trim().replace(/\s+/g,' ');if(/[\u0000-\u001f\u007f<>]/.test(text))throw new Error('formation-text-invalid');return text.slice(0,max);};
const positive=value=>{const n=Number(value);if(!Number.isFinite(n)||n<=0||!Number.isSafeInteger(Math.round(n)))throw new Error('formation-capital-invalid');return Math.round(n);};
function hashOwner(){const owner=globalThis.GH_CONTROL_PLANE;if(!owner?.stable||!owner?.sha256)throw new Error('formation-hash-owner-unavailable');return owner;}
function hash(value){const owner=hashOwner();return owner.sha256(owner.stable(value));}
function platform(){return globalThis.GH_COMPANY_PLATFORM||null;}
function definitionCompanyId(definition){return clean(definition?.companyId||definition?.id,80);}
function versionedDefinitionId(definition){return clean(definition?.definitionId||definition?.id,80);}
function resolveDefinition(entityKind,id,input,hooks={}){
 const P=platform();
 if(P){if(!P.isKnownCompany?.(id))throw new Error(`formation-company-unknown:${id}`);const definition=P.getDefinition?.(id);if(!definition)throw new Error(`formation-definition-unavailable:${id}`);return clone(definition);}
 const resolved=hooks.resolveDefinition?.(id,entityKind)||input.definition;
 if(!resolved||definitionCompanyId(resolved)!==id)throw new Error(`formation-registry-unavailable:${id}`);
 return clone(resolved);
}
function normalizedLocation(value={}){
 const id=clean(value.id||value.locationId,48),city=clean(value.city,80),country=clean(value.country,80),coords=Array.isArray(value.coords)?value.coords.map(Number):null;
 if(!id||!city||!country)throw new Error('formation-location-invalid');
 if(coords&&(!(coords.length>=2)||!Number.isFinite(coords[0])||!Number.isFinite(coords[1])||coords[0]<-90||coords[0]>90||coords[1]<-180||coords[1]>180))throw new Error('formation-location-coordinates-invalid');
 return {id,city,country,...(coords?{coords:[coords[0],coords[1]]}:{})};
}
function normalizedIdentity(input={},definition={}){
 const names=definition.names||{},brand=definition.identity||{},legalFallback=brand.legalDefault?.ar||brand.legalDefault||names.legal?.ar||names.legal||definition.legalName||'',displayFallback=brand.trade?.ar||brand.trade||names.display?.ar||names.display||legalFallback;
 const legalName=clean(input.legalName||input.name||legalFallback,80),displayName=clean(input.displayName||displayFallback||legalName,60),shortName=clean(input.shortName||brand.short||names.short||definition.shortName||'',12).toUpperCase();
 if(!legalName||!displayName||!shortName||!/^[-\p{L}\p{N} .&]{1,12}$/u.test(shortName))throw new Error('formation-identity-invalid');
 const identity=clone(input.identity||{});if(!identity||typeof identity!=='object'||Array.isArray(identity))throw new Error('formation-identity-assets-invalid');
 return {legalName,displayName,shortName,englishName:clean(input.englishName,100),identity};
}
function normalizedGovernance(input={}){return {riskAppetite:clean(input.riskAppetite||'balanced',32),procurementPolicy:clean(input.procurementPolicy||'competitive',48),signingAuthority:clean(input.signingAuthority||'founder',48)};}
function validateEffects(effects){if(!Array.isArray(effects)||!effects.length)throw new Error('formation-effects-missing');for(const effect of effects){if(!effect||typeof effect!=='object'||!clean(effect.type,80))throw new Error('formation-effect-invalid');if(FORBIDDEN_EFFECTS.has(effect.type)||effect.grantsAsset===true||effect.grantsFacility===true)throw new Error(`formation-free-operational-asset-forbidden:${effect.type}`);}}
function planBody(plan){const body=clone(plan);delete body.planHash;delete body.planId;return body;}
function validatePlan(plan){
 if(!plan||plan.schema!==SCHEMA||!ALLOWED_ENTITY_KINDS.has(plan.entityKind))throw new Error('formation-plan-invalid');
 if(!plan.companyId||!plan.definitionId||!plan.definitionVersion||!plan.identity?.legalName||!plan.signature?.signatureRef)throw new Error('formation-plan-incomplete');
 if(!Number.isSafeInteger(Number(plan.signature.version))||Number(plan.signature.version)<1)throw new Error('formation-signature-version-invalid');
 if([plan.openingAssets,plan.openingFacilities,plan.openingRoutes].some(rows=>!Array.isArray(rows)||rows.length))throw new Error('formation-opening-entitlements-forbidden');
 positive(plan.capital?.amount);validateEffects(plan.effects);
 for(const effect of plan.effects){if([effect.payload?.openingAssets,effect.payload?.openingFacilities,effect.payload?.openingRoutes].some(rows=>rows!==undefined&&(!Array.isArray(rows)||rows.length)))throw new Error('formation-effect-opening-entitlements-forbidden');}
 if(plan.constraints?.freeOperationalAssets!==false||plan.constraints?.freeOperationalFacilities!==false)throw new Error('formation-constraints-invalid');
 const expected=hash(planBody(plan));if(expected!==plan.planHash)throw new Error('formation-plan-hash-mismatch');return true;
}
function prepare(input={},hooks={}){
 const entityKind=clean(input.entityKind||'company',20);if(!ALLOWED_ENTITY_KINDS.has(entityKind))throw new Error('formation-entity-kind-invalid');
 const companyId=clean(input.companyId||input.definitionId||(entityKind==='group'?'group':''),80);if(!companyId)throw new Error('formation-company-required');
 const definition=resolveDefinition(entityKind,companyId,input,hooks),resolvedCompanyId=definitionCompanyId(definition),resolvedDefinitionId=versionedDefinitionId(definition);if(resolvedCompanyId!==companyId||!resolvedDefinitionId)throw new Error('formation-definition-id-mismatch');
 const definitionVersion=Math.max(1,Math.floor(Number(definition.definitionVersion||definition.version)||1)),identity=normalizedIdentity(input,definition),location=normalizedLocation(input.location||input),capitalAmount=positive(input.capital??input.capitalAmount??definition.founding?.defaultCapital??definition.founding?.recommendedCapital);
 const founder=clean(input.founder||input.owner,80);if(!founder)throw new Error('formation-founder-required');
 const signatureRef=clean(input.signatureRef||input.signature?.signatureRef||input.signature?.ref,120),signatureVersion=Math.max(1,Math.floor(Number(input.signatureVersion||input.signatureRevision||input.signature?.version||input.signature?.revision)||1));if(!signatureRef)throw new Error('formation-signature-required');
 const createdAt=Math.max(0,Number(input.createdAt)||0),governance=normalizedGovernance(input.governance||input),currency=clean(input.currency||definition.founding?.currency||'USD',8).toUpperCase();
 const payload={entityKind,companyId,definitionId:resolvedDefinitionId,definitionVersion,identity,founder,location,capital:{amount:capitalAmount,currency,source:entityKind==='group'?'founder':'group'},governance,signature:{signatureRef,version:signatureVersion},openingAssets:[],openingFacilities:[],openingRoutes:[]};
 const effects=[{type:'formation.commit-entity',domain:'formation',command:entityKind==='group'?'found-group':'open-company',payload}];
 const draft={schema:SCHEMA,engineVersion:VERSION,entityKind,companyId,definitionId:resolvedDefinitionId,definitionVersion,createdAt,identity,founder,location,capital:payload.capital,governance,signature:payload.signature,openingAssets:[],openingFacilities:[],openingRoutes:[],effects,constraints:{freeOperationalAssets:false,freeOperationalFacilities:false,freeRoutes:false,allOrNothing:true,durableSaveRequired:true},metadata:{definitionHash:hash({id:resolvedDefinitionId,version:definitionVersion,capabilities:definition.capabilities||[]})}};
 draft.planHash=hash(planBody(draft));draft.planId=`FORM-${draft.planHash.slice(0,20).toUpperCase()}`;validatePlan(draft);return deepFreeze(draft);
}
async function commit(plan,{hooks={},actor='formation-ui',timeoutMs=15000}={}){
 validatePlan(plan);const runAtomic=hooks.runAtomic||hooks.atomic,applyEffect=hooks.applyEffect||hooks.apply,durableSave=hooks.durableSave||hooks.persist;
 if(typeof runAtomic!=='function'||typeof applyEffect!=='function'||typeof durableSave!=='function')throw new Error('formation-commit-hooks-incomplete');
 const controller=typeof AbortController==='function'?new AbortController():null,limit=Math.max(250,Math.min(120000,Number(timeoutMs)||15000));
 const durableAck=async payload=>{let timer;try{const result=await Promise.race([Promise.resolve(durableSave({...payload,signal:controller?.signal})),new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new Error('formation-durable-save-timeout'));queueMicrotask(()=>controller?.abort('formation-durable-save-timeout'));},limit);})]);if(!(result===true||result?.ack===true||result?.durable===true||result?.status==='ACK')||result?.ok===false)throw new Error('formation-durable-save-nack');return result;}finally{clearTimeout(timer);}};
 const operation={label:`formation:${plan.entityKind}:${plan.companyId}`,idempotencyKey:plan.planId,planHash:plan.planHash,actor,async apply(){
  const receipts=[];for(let index=0;index<plan.effects.length;index++){const effect=clone(plan.effects[index]);const receipt=await applyEffect(effect,{plan,index,actor,idempotencyKey:`${plan.planId}:${index}`});if(receipt===false||receipt?.ok===false)throw new Error(`formation-effect-rejected:${effect.type}`);receipts.push(clone(receipt));}
  const saved=await durableAck({plan,receipts,actor,idempotencyKey:plan.planId});return {ok:true,planId:plan.planId,planHash:plan.planHash,receipts,saved:clone(saved)};
 }};
 const result=await runAtomic(operation);if(result===false||result?.ok===false||result?.committed!==true)throw new Error('formation-atomic-commit-failed');try{await hooks.afterCommit?.({plan,result,actor});}catch(_error){}return result?.value??result;
}
const API=Object.freeze({VERSION,SCHEMA,FORBIDDEN_EFFECTS,prepare,commit,validatePlan,hash,clone});
globalThis.GH_FORMATION_ENGINE=API;if(globalThis.window&&window!==globalThis)window.GH_FORMATION_ENGINE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
