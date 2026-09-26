(()=>{'use strict';
const VERSION='GH-IDENTITY-334.2.0',REGISTRY_VERSION='GH-COMPANY-REGISTRY-FACADE-1.0.0';
const SOURCE=globalThis.GH_COMPANY_DEFINITIONS,PLATFORM=globalThis.GH_COMPANY_PLATFORM;
if(!SOURCE?.list||!SOURCE?.get)throw new Error('company-definitions-required-before-identity-system');
if(!PLATFORM?.getDefinition||!PLATFORM?.listDefinitions||!PLATFORM?.definitionFor)throw new Error('company-platform-required-before-identity-system');
const COLOR_PATTERN=/^#[0-9a-f]{6}$/i;
const LOGO_USAGES=Object.freeze(['symbol','horizontal','documentSeal','monochrome']);
const CUSTOM_LOGO_LIMITS=Object.freeze({dataUrlLength:280000,decodedBytes:209982,maxWidth:4096,maxHeight:4096,maxPixels:16000000});
const SOURCE_LOGO_LIMITS=Object.freeze({decodedBytes:8*1024*1024,maxWidth:4096,maxHeight:4096,maxPixels:16000000});
const CUSTOM_LOGO_MIMES=Object.freeze(new Set(['image/png','image/jpeg','image/webp']));
const UNKNOWN_LOGO=`data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect x="3" y="3" width="90" height="90" rx="24" fill="#dfe8e6"/><path d="M28 34h40M28 48h40M28 62h25" stroke="#5c727d" stroke-width="7" stroke-linecap="round"/><circle cx="70" cy="67" r="10" fill="#0d3b57"/><path d="M70 62v7" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="70" cy="73" r="2" fill="#fff"/></svg>')}`;
function deepFreeze(value,seen=new Set()){
  if(!value||typeof value!=='object'||seen.has(value))return value;seen.add(value);
  for(const child of Object.values(value))deepFreeze(child,seen);return Object.freeze(value);
}
const UNKNOWN_DEFINITION=deepFreeze({
  id:'unknown',definitionId:null,kind:'unknown',order:9999,sectorId:'unknown',known:false,
  labels:{ar:{short:'—',display:'كيان غير معروف',legal:'كيان غير معروف',map:'كيان غير معروف'},en:{short:'—',display:'Unknown entity',legal:'Unknown entity',map:'Unknown entity'}},
  identity:{logos:{symbol:UNKNOWN_LOGO,horizontal:UNKNOWN_LOGO,documentSeal:UNKNOWN_LOGO,monochrome:UNKNOWN_LOGO},accent:'#5c727d',secondary:'#0d3b57',route:'#5c727d'},
  capabilities:[],assetKinds:[],routeModes:[],facilityKinds:[],legacyNames:[],source:null
});
const GAME_DEFINITION=deepFreeze({
  id:'game',definitionId:'global-holdings-game-v1',kind:'game',order:-20,sectorId:'system',known:true,
  labels:{ar:{short:'GH',display:'Global Holdings',legal:'Global Holdings',map:'GH'},en:{short:'GH',display:'Global Holdings',legal:'Global Holdings',map:'GH'}},
  identity:{logos:{symbol:'assets/identity/global-holdings.svg',horizontal:'assets/identity/global-holdings.svg',documentSeal:'assets/identity/global-holdings.svg',monochrome:'assets/identity/global-holdings.svg'},accent:'#2d72df',secondary:'#0d3b57',route:'#2d72df'},
  capabilities:['identity.system'],assetKinds:[],routeModes:[],facilityKinds:[],legacyNames:[],source:null
});
function esc(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function cleanText(value,fallback='',maximum=160){const text=String(value??'').trim();return (text||fallback).slice(0,maximum);}
function uniqueStrings(value){return [...new Set((Array.isArray(value)?value:[]).map(item=>String(item||'').trim()).filter(Boolean))];}
function validColor(value){return COLOR_PATTERN.test(String(value||''));}
function safeAssetPath(value){const text=String(value||'');return /^assets\/[a-zA-Z0-9_.\/-]+\.(?:svg|png|jpe?g|webp)$/i.test(text)&&!text.split('/').includes('..');}
function validRuntimeLogo(value){const text=String(value||'');return safeAssetPath(text)||/^data:image\/svg\+xml(?:;charset=[^,;]+)?,/i.test(text);}
function inspectPlainText(value,{minimum=1,maximum=160,allowEmpty=false}={}){
  if(typeof value!=='string')return {ok:false,reason:'text-type'};
  const text=value.trim();if(!text)return allowEmpty?{ok:true,text:''}:{ok:false,reason:'text-empty'};
  if(text.length<minimum||text.length>maximum)return {ok:false,reason:'text-length'};
  if(/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text))return {ok:false,reason:'text-markup-or-control'};
  return {ok:true,text};
}
function validPlainText(value,options){return inspectPlainText(value,options).ok;}
function decodeBase64(value){
  const input=String(value||'');if(!input||input.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input))return null;
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',padding=input.endsWith('==')?2:input.endsWith('=')?1:0,output=new Uint8Array(input.length/4*3-padding);let cursor=0;
  for(let index=0;index<input.length;index+=4){const a=alphabet.indexOf(input[index]),b=alphabet.indexOf(input[index+1]),c=input[index+2]==='='?0:alphabet.indexOf(input[index+2]),d=input[index+3]==='='?0:alphabet.indexOf(input[index+3]);if(a<0||b<0||c<0||d<0)return null;const bits=(a<<18)|(b<<12)|(c<<6)|d;if(cursor<output.length)output[cursor++]=(bits>>>16)&255;if(cursor<output.length)output[cursor++]=(bits>>>8)&255;if(cursor<output.length)output[cursor++]=bits&255;}
  return output;
}
function ascii(bytes,offset,length){let value='';for(let index=0;index<length;index++)value+=String.fromCharCode(bytes[offset+index]||0);return value;}
function u16be(bytes,offset){return (bytes[offset]<<8)|bytes[offset+1];}
function u32be(bytes,offset){return ((bytes[offset]*0x1000000)+(bytes[offset+1]<<16)+(bytes[offset+2]<<8)+bytes[offset+3])>>>0;}
function pngDimensions(bytes){if(bytes.length<24||ascii(bytes,0,8)!=='\x89PNG\r\n\x1a\n'||ascii(bytes,12,4)!=='IHDR')return null;return {width:u32be(bytes,16),height:u32be(bytes,20)};}
function jpegDimensions(bytes){
  if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff)return null;const startsOfFrame=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);let offset=2;
  while(offset+3<bytes.length){while(offset<bytes.length&&bytes[offset]!==0xff)offset++;while(offset<bytes.length&&bytes[offset]===0xff)offset++;if(offset>=bytes.length)break;const marker=bytes[offset++];if(marker===0xd9||marker===0xda)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd8))continue;if(offset+1>=bytes.length)return null;const length=u16be(bytes,offset);if(length<2||offset+length>bytes.length)return null;if(startsOfFrame.has(marker)){if(length<7)return null;return {height:u16be(bytes,offset+3),width:u16be(bytes,offset+5)};}offset+=length;
  }
  return null;
}
function webpDimensions(bytes){
  if(bytes.length<30||ascii(bytes,0,4)!=='RIFF'||ascii(bytes,8,4)!=='WEBP')return null;const kind=ascii(bytes,12,4),payload=20;
  if(kind==='VP8X')return {width:1+bytes[24]+bytes[25]*256+bytes[26]*65536,height:1+bytes[27]+bytes[28]*256+bytes[29]*65536};
  if(kind==='VP8L'&&bytes.length>=25&&bytes[payload]===0x2f)return {width:1+(bytes[21]|((bytes[22]&0x3f)<<8)),height:1+((bytes[22]>>>6)|(bytes[23]<<2)|((bytes[24]&0x0f)<<10))};
  if(kind==='VP8 '&&bytes.length>=30&&bytes[23]===0x9d&&bytes[24]===0x01&&bytes[25]===0x2a)return {width:(bytes[26]|bytes[27]<<8)&0x3fff,height:(bytes[28]|bytes[29]<<8)&0x3fff};
  return null;
}
function inspectImageBytes(value,mime,limits=SOURCE_LOGO_LIMITS){
  const bytes=value instanceof Uint8Array?value:new Uint8Array(value||0),declared=String(mime||'').toLowerCase();if(!CUSTOM_LOGO_MIMES.has(declared))return {ok:false,reason:'logo-mime'};if(!bytes.length||bytes.length>Number(limits.decodedBytes||0))return {ok:false,reason:'logo-size'};
  const detected=pngDimensions(bytes)?'image/png':jpegDimensions(bytes)?'image/jpeg':webpDimensions(bytes)?'image/webp':null;if(!detected||detected!==declared)return {ok:false,reason:'logo-magic'};const dimensions=detected==='image/png'?pngDimensions(bytes):detected==='image/jpeg'?jpegDimensions(bytes):webpDimensions(bytes),width=Number(dimensions?.width)||0,height=Number(dimensions?.height)||0;
  if(width<1||height<1||width>Number(limits.maxWidth)||height>Number(limits.maxHeight)||width*height>Number(limits.maxPixels))return {ok:false,reason:'logo-dimensions',mime:detected,width,height,bytes:bytes.length};return {ok:true,mime:detected,width,height,bytes:bytes.length};
}
function inspectCustomLogo(value){
  const text=String(value||'');if(safeAssetPath(text))return {ok:true,kind:'asset',path:text};if(!text||text.length>CUSTOM_LOGO_LIMITS.dataUrlLength)return {ok:false,reason:'logo-size'};const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(text);if(!match)return {ok:false,reason:'logo-data-url'};const bytes=decodeBase64(match[2]);if(!bytes)return {ok:false,reason:'logo-base64'};return inspectImageBytes(bytes,`image/${match[1].toLowerCase()}`,CUSTOM_LOGO_LIMITS);
}
function validCustomLogo(value){return inspectCustomLogo(value).ok;}
async function inspectLogoFile(file,{allowTranscode=false}={}){
  const mime=String(file?.type||'').toLowerCase(),size=Number(file?.size);if(!file||!CUSTOM_LOGO_MIMES.has(mime))return {ok:false,reason:'logo-mime'};if(!Number.isFinite(size)||size<1||size>SOURCE_LOGO_LIMITS.decodedBytes)return {ok:false,reason:'logo-size'};const declaredTranscode=size>CUSTOM_LOGO_LIMITS.decodedBytes;if(declaredTranscode&&!allowTranscode)return {ok:false,reason:'logo-transcode-required',bytes:size,transcodeRequired:true};try{const result=inspectImageBytes(new Uint8Array(await file.arrayBuffer()),mime,SOURCE_LOGO_LIMITS);if(!result.ok)return result;const transcodeRequired=declaredTranscode||result.bytes>CUSTOM_LOGO_LIMITS.decodedBytes;if(transcodeRequired&&!allowTranscode)return {...result,ok:false,reason:'logo-transcode-required',transcodeRequired:true};return {...result,transcodeRequired};}catch(_error){return {ok:false,reason:'logo-read'};}
}
function installLogoUploadGuard(){
  if(typeof document==='undefined'||document.documentElement?.dataset?.ghLogoGuard)return false;if(document.documentElement)document.documentElement.dataset.ghLogoGuard='1';const approved=new WeakSet(),messageFor=reason=>({
    'logo-mime':'اختر شعارًا بصيغة PNG أو JPEG أو WebP.','logo-size':'حجم ملف الشعار غير صالح أو يتجاوز 8MB.','logo-magic':'امتداد الشعار أو MIME لا يطابق محتوى الصورة.','logo-dimensions':'أبعاد الشعار كبيرة جدًا للمعالجة الآمنة.','logo-transcode-required':'يجب ضغط الشعار قبل الحفظ؛ مسار الرفع الحالي لا يوفّر ضاغطًا آمنًا.','logo-read':'تعذر فحص ملف الشعار بأمان.'
  }[reason]||'ملف الشعار غير صالح.');
  document.addEventListener('change',event=>{const input=event.target;if(!input?.matches?.('#founderLogoUpload,.company-logo-upload input[type="file"]'))return;if(approved.has(input)){approved.delete(input);return;}const file=input.files?.[0];if(!file)return;event.preventDefault();event.stopImmediatePropagation();/* These two inputs are owned by app.js compressLogoFile: decode, resize to 360px, canvas re-encode, then enforce the 280k data-URL cap before any state command. */void inspectLogoFile(file,{allowTranscode:true}).then(result=>{if(!result.ok)throw new Error(messageFor(result.reason));input.dataset.ghLogoTranscode=result.transcodeRequired?'required':'optional';input.setCustomValidity?.('');approved.add(input);input.dispatchEvent(new Event('change',{bubbles:true}));}).catch(error=>{const message=String(error?.message||'ملف الشعار غير صالح.');input.value='';delete input.dataset.ghLogoTranscode;input.setCustomValidity?.(message);input.reportValidity?.();const status=input.id==='founderLogoUpload'?document.getElementById('founderLogoStatus'):null;if(status)status.textContent=message;globalThis.dispatchEvent?.(new CustomEvent('gh-logo-validation-error',{detail:{message}}));});},true);return true;
}
function markLogos(identity={}){
  const marks=identity.marks&&typeof identity.marks==='object'?identity.marks:{},primary=String(marks.default||marks.symbol||marks.horizontal||marks.seal||marks.mono||''),candidates={symbol:marks.symbol||primary,horizontal:marks.horizontal||primary,documentSeal:marks.seal||primary,monochrome:marks.mono||primary},logos={};
  for(const usage of LOGO_USAGES){const path=String(candidates[usage]||'');logos[usage]=validRuntimeLogo(path)?path:UNKNOWN_LOGO;}return logos;
}
function adaptDefinition(raw,idOverride=''){
  if(!raw||typeof raw!=='object')return UNKNOWN_DEFINITION;
  const id=cleanText(idOverride||raw.id,'unknown',80),identity=raw.identity&&typeof raw.identity==='object'?raw.identity:{},palette=identity.palette&&typeof identity.palette==='object'?identity.palette:{},classification=raw.classification&&typeof raw.classification==='object'?raw.classification:{},legacy=raw.legacy&&typeof raw.legacy==='object'?raw.legacy:{},facilities=raw.facilities&&typeof raw.facilities==='object'?raw.facilities:{};
  const arLegal=cleanText(identity.legalDefault?.ar,identity.legalDefault?.en||id,120),enLegal=cleanText(identity.legalDefault?.en,arLegal,120),arDisplay=cleanText(identity.trade?.ar,arLegal,80),enDisplay=cleanText(identity.trade?.en,enLegal,80),short=cleanText(identity.short,enDisplay||id.toUpperCase(),28),accent=validColor(palette.accent)?String(palette.accent).toLowerCase():'#5c727d',secondary=validColor(palette.secondary)?String(palette.secondary).toLowerCase():'#0d3b57',route=validColor(palette.route)?String(palette.route).toLowerCase():accent;
  return deepFreeze({id,definitionId:String(raw.definitionId||raw.id||''),kind:raw.kind==='holding'?'group':'subsidiary',order:Number.isFinite(Number(raw.order))?Number(raw.order):1000,sectorId:String(classification.primarySectorId||'unknown'),known:true,labels:{ar:{short,display:arDisplay,legal:arLegal,map:short},en:{short,display:enDisplay,legal:enLegal,map:short}},identity:{logos:markLogos(identity),accent,secondary,route},capabilities:uniqueStrings(raw.capabilities),assetKinds:uniqueStrings([...(classification.assetClasses||[]),...(legacy.assetOwnerModes||[])]),routeModes:uniqueStrings([...(classification.routeModes||[]),...(legacy.routeOwnerModes||[])]),facilityKinds:uniqueStrings(facilities.allowedKinds),legacyNames:uniqueStrings([...(identity.legacyLegalNames||[]),...(legacy.companyAliases||[])]),source:raw});
}
function rawDefinition(state,type){const id=String(type||'').trim();if(id==='game')return GAME_DEFINITION;return (state&&PLATFORM.definitionFor(state,id))||PLATFORM.getDefinition(id)||SOURCE.get(id)||null;}
function definition(type='group',state=null){const id=String(type||'').trim();if(id==='game')return GAME_DEFINITION;const raw=rawDefinition(state,id);return raw?adaptDefinition(raw,id):UNKNOWN_DEFINITION;}
function rawDefinitions(options={}){
  const state=options.state&&typeof options.state==='object'?options.state:null;
  if(state&&PLATFORM.listInstances)return PLATFORM.listInstances(state,{includeGroup:options.includeGroup!==false,openedOnly:options.openedOnly===true}).filter(row=>row.definition).map(row=>({id:row.id,raw:row.definition}));
  return PLATFORM.listDefinitions({includeGroup:options.includeGroup!==false,lifecycle:options.lifecycle}).map(raw=>({id:raw.id,raw}));
}
function list(options={}){const capability=String(options.capability||''),kind=String(options.kind||''),rows=rawDefinitions(options).map(row=>adaptDefinition(row.raw,row.id));if(options.includeGame===true)rows.push(GAME_DEFINITION);return rows.filter(row=>(!kind||row.kind===kind)&&(!capability||row.capabilities.includes(capability))).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));}
function has(type,state=null){const id=String(type||'').trim();return id==='game'||Boolean(rawDefinition(state,id));}
function hasCapability(type,capability,state=null){return has(type,state)&&definition(type,state).capabilities.includes(String(capability||''));}
function register(input,options={}){return adaptDefinition(PLATFORM.installDefinition(input,options));}
function registerBundle(rows,options={}){return PLATFORM.installDefinitions(rows,options).map(row=>adaptDefinition(row));}
function seal(){return PLATFORM.seal();}
function companyOf(entity={},state=null){const explicit=String(entity.ownerCompanyId||entity.companyId||entity.company||'').trim();if(explicit)return has(explicit,state)?explicit:null;const assetKind=String(entity.assetClass||entity.assetKind||entity.assetClassId||entity.type||''),routeMode=String(entity.routeMode||''),facilityKind=String(entity.facilityKind||entity.kind||''),matches=list({state,kind:'subsidiary'}).filter(row=>(assetKind&&row.assetKinds.includes(assetKind))||(routeMode&&row.routeModes.includes(routeMode))||(facilityKind&&row.facilityKinds.includes(facilityKind)));return matches.length===1?matches[0].id:null;}
function diagnostics(){const snapshot=PLATFORM.snapshot?.()||{};return Object.freeze({version:REGISTRY_VERSION,sealed:Boolean(snapshot.sealed),count:Number(snapshot.definitions)||list().length,ids:Object.freeze(list().map(row=>row.id)),sourceVersion:SOURCE.VERSION,platformVersion:PLATFORM.VERSION});}

function legacyBrand(row){return Object.freeze({short:row.labels.ar.short,display:row.labels.ar.display,legal:row.labels.ar.legal,logo:row.identity.logos.symbol,logos:row.identity.logos,accent:row.identity.accent,secondary:row.identity.secondary,route:row.identity.route,known:row.known});}
const BRANDS=Object.freeze(Object.fromEntries([GAME_DEFINITION,...list()].map(row=>[row.id,legacyBrand(row)])));
const LEGACY_NAMES=Object.freeze(Object.fromEntries(list().filter(row=>row.legacyNames.length).map(row=>[row.id,Object.freeze([...row.legacyNames])])));
function brand(type='group',state=null){return legacyBrand(definition(type,state));}
function record(state,type){if(type!=='group')return state?.companyRegistry?.[type]||{};const registered=state?.companyRegistry?.group||{},profile=state?.profile||{};return {...registered,...profile,identity:{...(registered.identity||{}),...(profile.identity||{})}};}
function isLegacyDefault(type,value,state=null){return definition(type,state).legacyNames.includes(String(value||'').trim());}
function preferredLanguage(options={}){return options.language==='en'?'en':'ar';}
function legalName(state,type='group',options={}){
  const row=record(state,type),saved=String(type==='group'?(row.name||row.legalName||''):(row.legalName||row.name||'')).trim();if(saved&&validPlainText(saved,{maximum:120})&&!isLegacyDefault(type,saved,state))return saved;
  return definition(type,state).labels[preferredLanguage(options)].legal;
}
function shortName(state,type='group',options={}){
  const saved=String(record(state,type).shortName||'').trim();if(saved&&validPlainText(saved,{maximum:28}))return saved;
  return definition(type,state).labels[preferredLanguage(options)].short;
}
function displayName(state,type='group',compact=false,options={}){return compact?shortName(state,type,options):legalName(state,type,options);}
function customLogoVariants(row){
  const nested=row?.identity?.logos&&typeof row.identity.logos==='object'?row.identity.logos:row?.logoVariants&&typeof row.logoVariants==='object'?row.logoVariants:{};
  const variants={};for(const usage of LOGO_USAGES){const value=String(nested[usage]||'');if(validCustomLogo(value))variants[usage]=value;}
  const primary=String(row?.logo||nested.primary||'');if(validCustomLogo(primary))variants.primary=primary;return variants;
}
function resolve(state,type='group',options={}){
  const def=definition(type,state),row=record(state,type),usage=LOGO_USAGES.includes(options.usage)?options.usage:'symbol',custom=customLogoVariants(row),customLogo=custom[usage]||custom.primary||null;
  const accent=validColor(row?.identity?.accent)?String(row.identity.accent).toLowerCase():validColor(row?.accent)?String(row.accent).toLowerCase():def.identity.accent,secondary=validColor(row?.identity?.secondary)?String(row.identity.secondary).toLowerCase():def.identity.secondary,route=validColor(row?.identity?.route)?String(row.identity.route).toLowerCase():def.identity.route;
  return Object.freeze({
    type:String(type||'unknown'),known:def.known,usage,customized:Boolean(customLogo||row?.legalName||row?.shortName||(type==='group'&&(row?.name||row?.shortName))),
    short:shortName(state,type,options),display:displayName(state,type,false,options),legal:legalName(state,type,options),mapLabel:validPlainText(String(row?.mapName||''),{maximum:48})?String(row.mapName).trim():def.labels[preferredLanguage(options)].map,
    logo:customLogo||def.identity.logos[usage],customLogo:Boolean(customLogo),accent,secondary,route,definition:def
  });
}
function logo(state,type='group',usage='symbol'){const options=typeof usage==='object'?usage:{usage};return resolve(state,type,options).logo;}
function cssTokens(state,type='group'){const current=resolve(state,type);return Object.freeze({'--company-accent':current.accent,'--company-secondary':current.secondary,'--company-route':current.route});}
function logoMarkup(state,type='group',sizeOrOptions='normal',legacyClassName='company-logo-badge'){
  const modern=sizeOrOptions&&typeof sizeOrOptions==='object',options=modern?{...sizeOrOptions}:{size:sizeOrOptions,className:legacyClassName,element:'badge'},current=resolve(state,type,options),size=['small','tiny'].includes(options.size)?options.size:'normal';
  const alt=options.decorative?'':cleanText(options.alt,`شعار ${current.legal}`,160),aria=options.decorative?' aria-hidden="true"':'',imgClass=cleanText(options.imageClass||(!modern?'':options.className),'',80),img=`<img${imgClass?` class="${esc(imgClass)}"`:''} src="${esc(current.logo)}" alt="${esc(alt)}"${aria} data-logo-usage="${esc(current.usage)}">`;
  if(modern&&options.element!=='badge'&&options.wrapper!==true)return img;
  const className=cleanText(options.className,'company-logo-badge',80),sizeClass=size==='normal'?'':` ${size}`;
  return `<div class="${esc(className)}${sizeClass}" data-company="${esc(type)}" data-custom="${current.customLogo?'true':'false'}" data-known="${current.known?'true':'false'}">${img}</div>`;
}
function applyDocument(state){
  if(typeof document==='undefined')return false;const current=resolve(state,'group'),root=document.documentElement;
  root.dataset.ghIdentity=VERSION;root.style.setProperty('--group-accent',current.accent);root.style.setProperty('--group-secondary',current.secondary);
  const name=document.getElementById('groupName'),mark=document.getElementById('brandMark');if(name)name.textContent=current.legal;
  if(mark&&mark.dataset.logo!==current.logo){mark.replaceChildren();const img=document.createElement('img');img.src=current.logo;img.alt='';mark.append(img);mark.dataset.logo=current.logo;}return true;
}
const COMPANY_API=Object.freeze({VERSION:REGISTRY_VERSION,register,registerBundle,seal,definition,list,has,hasCapability,companyOf,diagnostics});
const API=Object.freeze({VERSION,REGISTRY_VERSION,LOGO_USAGES,CUSTOM_LOGO_LIMITS,UNKNOWN_LOGO,BRANDS,LEGACY_NAMES,brand,definition,listDefinitions:list,registerDefinition:register,registerDefinitions:registerBundle,sealRegistry:seal,legalName,shortName,displayName,logo,logoMarkup,resolve,cssTokens,applyDocument,isLegacyDefault,inspectPlainText,validPlainText,inspectImageBytes,inspectCustomLogo,inspectLogoFile,validCustomLogo});
globalThis.GH_COMPANY_REGISTRY=COMPANY_API;globalThis.GH_IDENTITY=API;
if(globalThis.window&&window!==globalThis){window.GH_COMPANY_REGISTRY=COMPANY_API;window.GH_IDENTITY=API;}
installLogoUploadGuard();
if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
