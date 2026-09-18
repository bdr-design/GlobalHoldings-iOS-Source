(()=>{'use strict';
const VERSION='3.0.0',num=v=>Math.max(0,Number(v)||0),now=s=>Number(s.simSeconds)||0;
function ensure(s){s.contractRegistry=s.contractRegistry&&typeof s.contractRegistry==='object'&&!Array.isArray(s.contractRegistry)?s.contractRegistry:{};s.acceptedContracts=Array.isArray(s.acceptedContracts)?s.acceptedContracts:[];s.failedBids=Array.isArray(s.failedBids)?s.failedBids:[];s.contractStartDays=s.contractStartDays&&typeof s.contractStartDays==='object'&&!Array.isArray(s.contractStartDays)?s.contractStartDays:{};return s;}
function world(s,cmd,p){try{return globalThis.GH_BUSINESS_WORLD?.execute?.({state:s},cmd,p)||null;}catch(error){console.warn('business-world contract bridge rejected',cmd,error);return null;}}
function execute(ctx,cmd,p={}){const s=ctx.state||ctx;ensure(s);
 if(cmd==='bid'){
  const id=String(p.id||'');if(!id)throw new Error('contract-id-required');if(s.acceptedContracts.includes(id))throw new Error('contract-already-signed');const won=!!p.won,partyId=globalThis.GH_BUSINESS_WORLD?.partyIdForName?.(s,p.client,'customer')||null;
  if(won){const row={status:'بانتظار التوقيع',number:p.number||`GH-CN-${Math.floor(now(s))}-${Object.keys(s.contractRegistry).length+1}`,wonAt:now(s),client:p.client||'',clientPartyId:partyId,sector:p.sector||'',title:p.title||id,value:num(p.value),termMonths:num(p.termMonths)};s.contractRegistry[id]=row;world(s,'record-bid',{id,partyId,won:true,client:p.client,sector:p.sector,title:p.title});return {won:true,record:row};}
  if(!s.failedBids.includes(id))s.failedBids.push(id);world(s,'record-bid',{id,partyId,won:false,client:p.client,sector:p.sector,title:p.title,competitorId:p.competitorId,competitorName:p.competitorName});return {won:false,competitorId:p.competitorId||null};
 }
 if(cmd==='sign'){
  const id=String(p.id||''),doc=s.contractRegistry[id];if(!doc)throw new Error('contract-not-awarded');if(doc.status!=='بانتظار التوقيع')throw new Error('contract-not-signable');
  doc.status='نشط';doc.signedAt=now(s);doc.clientPartyId=doc.clientPartyId||globalThis.GH_BUSINESS_WORLD?.partyIdForName?.(s,p.client||doc.client,'customer')||null;if(!s.acceptedContracts.includes(id))s.acceptedContracts.push(id);s.contractStartDays[id]=Math.floor(now(s)/86400);
  if(num(p.deposit)>0)globalThis.GH_FINANCE_CORE?.execute?.({state:s},'credit',{company:p.company||p.sector||'group',amount:num(p.deposit),note:p.note||`دفعة مقدمة · ${p.name||id}`,method:'تحويل عميل',taxable:p.taxable!==false,counterparty:p.client||doc.client||'عميل تعاقدي',sourceRefs:[id]});
  world(s,'record-contract',{id,number:doc.number,partyId:doc.clientPartyId,client:p.client||doc.client,company:p.company||p.sector||doc.sector||'group',sector:p.sector||doc.sector,title:p.name||doc.title||id,value:num(p.value||doc.value),termMonths:num(p.termMonths||doc.termMonths),status:'نشط',signedAt:doc.signedAt});return doc;
 }
 if(cmd==='expire'){
  const id=String(p.id||''),doc=s.contractRegistry[id];if(!doc)return false;doc.status='منتهي';doc.endedAt=now(s);s.acceptedContracts=s.acceptedContracts.filter(x=>x!==id);delete s.contractStartDays[id];
  world(s,'record-contract',{id,number:doc.number,partyId:doc.clientPartyId,client:doc.client,company:doc.sector||'group',sector:doc.sector,title:doc.title||id,value:num(doc.value),termMonths:num(doc.termMonths),status:'منتهي'});return doc;
 }
 if(cmd==='tick-day'){const day=Math.max(0,Math.floor(Number(p.day)||0)),terms=p.terms&&typeof p.terms==='object'?p.terms:{},expired=[];for(const id of [...s.acceptedContracts]){const termDays=Math.max(1,Math.floor(Number(terms[id])||0));if(!termDays)continue;const start=Number(s.contractStartDays[id]??day);if(day-start>=termDays){execute({state:s},'expire',{id});expired.push(id);}}return {day,expired};}
 throw new Error(`Unknown contracts command: ${cmd}`);
}
const API={VERSION,ensure,execute};globalThis.GH_CONTRACTS_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('contracts',API);if(globalThis.window&&window!==globalThis)window.GH_CONTRACTS_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();