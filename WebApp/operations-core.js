(()=>{'use strict';
const VERSION='3.0.0',num=v=>Number(v)||0,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),now=s=>Number(s.simSeconds)||0;
function ensure(s){s.operations=s.operations&&typeof s.operations==='object'?s.operations:{};s.operations.dailyBriefs=Array.isArray(s.operations.dailyBriefs)?s.operations.dailyBriefs:[];s.operations.riskIndex=Math.max(0,Number(s.operations.riskIndex)||0);return s.operations;}
function execute(ctx,cmd,p={}){const s=ctx.state||ctx,o=ensure(s);
 if(cmd==='daily-brief'){const net=num(p.net),moving=Math.max(0,Math.floor(num(p.moving))),readiness=clamp(num(p.readiness),0,100),debt=Math.max(0,num(p.debt)),groupValue=Math.max(1,num(p.groupValue));o.riskIndex=clamp(Math.round(14+(100-readiness)*.65+debt/groupValue*32+Math.max(0,-net)/500000),0,100);const brief={day:Math.max(0,Math.floor(num(p.day))),net,moving,readiness:Math.round(readiness),risk:o.riskIndex};o.dailyBriefs.unshift(brief);o.dailyBriefs=o.dailyBriefs.slice(0,30);return brief;}
 if(cmd==='record-alerts'){
  const items=Array.isArray(p.items)?p.items:[],alerts=[],entries=[],ids=new Array(400),types=new Array(400),texts=new Array(400),initialLength=Array.isArray(s.eventLog)?s.eventLog.length:0,at=now(s),ordinalOffset=Math.max(0,Math.floor(num(p.ordinalOffset)));
  s.alerts=Array.isArray(s.alerts)?s.alerts:[];s.eventLog=Array.isArray(s.eventLog)?s.eventLog:[];
  let accepted=0;
  for(const item of items){const text=String(item?.text??item??'').trim();if(!text)continue;
   const slot=accepted%400,absoluteOrdinal=ordinalOffset+accepted,previousLength=absoluteOrdinal?Math.min(400,initialLength+absoluteOrdinal):initialLength;
   ids[slot]=item?.id||`OP-${Math.floor(at)}-${previousLength+1}`;types[slot]=item?.type||p.type||'operation';texts[slot]=text;accepted++;
  }
  if(!accepted)return false;
  for(let i=Math.max(0,accepted-400);i<accepted;i++){const slot=i%400;entries.push({id:ids[slot],at,type:types[slot],text:texts[slot]});}
  for(let i=Math.max(0,accepted-40);i<accepted;i++)alerts.push(texts[i%400]);
  s.alerts=[...alerts.slice(-40).reverse(),...s.alerts].slice(0,40);
  s.eventLog=[...entries.slice(-400).reverse(),...s.eventLog].slice(0,400);
  return true;
 }
 if(cmd==='record-alert'){s.alerts=Array.isArray(s.alerts)?s.alerts:[];s.eventLog=Array.isArray(s.eventLog)?s.eventLog:[];const text=String(p.text||'').trim();if(!text)return false;s.alerts=[text,...s.alerts].slice(0,40);s.eventLog=[{id:p.id||`OP-${Math.floor(now(s))}-${s.eventLog.length+1}`,at:now(s),type:p.type||'operation',text},...s.eventLog].slice(0,400);return true;}
 throw new Error(`Unknown operations command: ${cmd}`);
}
const API={VERSION,ensure,execute};globalThis.GH_OPERATIONS_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('operations',API);if(globalThis.window&&window!==globalThis)window.GH_OPERATIONS_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
