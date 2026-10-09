(()=>{
  'use strict';
  const VERSION='1.0.0',MAX_AGE_DAYS=400;
  const data=()=>globalThis.GH_MARKET_REFERENCE_DATA||(typeof require==='function'?require('./market-reference-data.js'):null);
  function normalizedCountry(value){return String(value||'').trim().toLowerCase().replace(/[._-]+/g,' ').replace(/\s+/g,' ');}
  const EURO_NAMES=new Set(['austria','belgium','bulgaria','croatia','cyprus','estonia','finland','france','germany','greece','ireland','italy','latvia','lithuania','luxembourg','malta','netherlands','the netherlands','portugal','slovakia','slovenia','spain','euro area','eurozone','eu euro area']);
  const COUNTRY_CODE=new Map([['at','euroArea'],['be','euroArea'],['bg','euroArea'],['cy','euroArea'],['de','euroArea'],['ee','euroArea'],['es','euroArea'],['fi','euroArea'],['fr','euroArea'],['gr','euroArea'],['hr','euroArea'],['ie','euroArea'],['it','euroArea'],['lt','euroArea'],['lu','euroArea'],['lv','euroArea'],['mt','euroArea'],['nl','euroArea'],['pt','euroArea'],['si','euroArea'],['sk','euroArea'],['us','unitedStates'],['usa','unitedStates'],['sa','saudiArabia']]);
  function ageDays(date,now){const parsed=Date.parse(`${date}T00:00:00Z`);return Number.isFinite(parsed)?Math.floor((Date.parse(now)-parsed)/86400000):Infinity;}
  function countryEntry(country,snapshot=data()){
    if(!snapshot?.entries)return null;const key=normalizedCountry(country);
    if(COUNTRY_CODE.has(key))return snapshot.entries[COUNTRY_CODE.get(key)]||null;
    if(EURO_NAMES.has(key))return snapshot.entries.euroArea||null;
    if(['united states','united states of america','usa','america'].includes(key))return snapshot.entries.unitedStates||null;
    if(['saudi arabia','kingdom of saudi arabia','المملكة العربية السعودية','السعودية'].includes(key))return snapshot.entries.saudiArabia||null;
    return null;
  }
  function referenceForCountry(country,{now=new Date().toISOString(),maxAgeDays=MAX_AGE_DAYS,snapshot=data()}={}){
    const entry=countryEntry(country,snapshot),ageDaysValue=entry?ageDays(entry.referenceDate,now):Infinity;
    if(!entry)return {available:false,fresh:false,reason:'unsupported-country',country:String(country||''),fallback:'simulation'};
    if(ageDaysValue<0||ageDaysValue>maxAgeDays)return {available:false,fresh:false,reason:'stale-reference',country:String(country||''),ageDays:ageDaysValue,maxAgeDays,fallback:'simulation',referenceId:entry.id,referenceDate:entry.referenceDate,sourceUrl:entry.sourceUrl,attribution:entry.attribution};
    return {available:true,fresh:true,reason:null,country:String(country||''),rate:entry.value,unit:snapshot.unit,benchmark:entry.benchmark,referenceId:entry.id,referenceDate:entry.referenceDate,retrievedAt:snapshot.retrievedAt,ageDays:ageDaysValue,maxAgeDays,sourceUrl:entry.sourceUrl,sourcePage:entry.sourcePage||entry.sourceUrl,attribution:entry.attribution,reuse:entry.reuse,coverage:entry.coverage};
  }
  function attachableReference(result){if(!result)return null;const {available,fresh,reason,country,rate,unit,benchmark,referenceId,referenceDate,retrievedAt,maxAgeDays,sourceUrl,sourcePage,attribution,reuse,coverage}=result;return {available:!!available,fresh:!!fresh,reason:reason||null,country,rate:Number.isFinite(rate)?rate:null,unit:unit||null,benchmark:benchmark||null,referenceId:referenceId||null,referenceDate:referenceDate||null,retrievedAt:retrievedAt||null,maxAgeDays:Number.isFinite(maxAgeDays)?maxAgeDays:null,sourceUrl:sourceUrl||null,sourcePage:sourcePage||null,attribution:attribution||null,reuse:reuse||null,coverage:coverage||null,fallback:available?null:'simulation'};}
  function persistedReference(result){if(!result)return null;return {referenceId:result.referenceId||null,country:String(result.country||''),rate:Number.isFinite(result.rate)?result.rate:null,referenceDate:result.referenceDate||null,sourceUrl:result.sourceUrl||null,fallback:result.available?null:'simulation'};}
  const API={VERSION,MAX_AGE_DAYS,referenceForCountry,attachableReference,persistedReference};
  globalThis.GH_MARKET_REFERENCE=API;if(globalThis.window&&window!==globalThis)window.GH_MARKET_REFERENCE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
