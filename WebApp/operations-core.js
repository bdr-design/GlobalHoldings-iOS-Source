(()=>{'use strict';
const VERSION='2.9.1',num=v=>Number(v)||0,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),now=s=>Number(s.simSeconds)||0;
function ensure(s){s.operations=s.operations&&typeof s.operations==='object'?s.operations:{};s.operations.dailyBriefs=Array.isArray(s.operations.dailyBriefs)?s.operations.dailyBriefs:[];s.operations.riskIndex=Math.max(0,Number(s.operations.riskIndex)||0);return s.operations;}
function execute(ctx,cmd,p={}){const s=ctx.state||ctx,o=ensure(s);
 if(cmd==='daily-brief'){const net=num(p.net),moving=Math.max(0,Math.floor(num(p.moving))),readiness=clamp(num(p.readiness),0,100),debt=Math.max(0,num(p.debt)),groupValue=Math.max(1,num(p.groupValue));o.riskIndex=clamp(Math.round(14+(100-readiness)*.65+debt/groupValue*32+Math.max(0,-net)/500000),0,100);const brief={day:Math.max(0,Math.floor(num(p.day))),net,moving,readiness:Math.round(readiness),risk:o.riskIndex};o.dailyBriefs.unshift(brief);o.dailyBriefs=o.dailyBriefs.slice(0,30);return brief;}
 if(cmd==='record-alert'){s.alerts=Array.isArray(s.alerts)?s.alerts:[];s.eventLog=Array.isArray(s.eventLog)?s.eventLog:[];const text=String(p.text||'').trim();if(!text)return false;s.alerts.unshift(text);s.alerts=s.alerts.slice(0,40);s.eventLog.unshift({id:p.id||`OP-${Math.floor(now(s))}-${s.eventLog.length+1}`,at:now(s),type:p.type||'operation',text});s.eventLog=s.eventLog.slice(0,400);return true;}
 throw new Error(`Unknown operations command: ${cmd}`);
}
const API={VERSION,ensure,execute};globalThis.GH_OPERATIONS_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('operations',API);if(globalThis.window&&window!==globalThis)window.GH_OPERATIONS_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
