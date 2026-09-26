(()=>{'use strict';
const VERSION='1.0.0';
const FORMS=Object.freeze({
 asset:{zero:'لا أصول',one:'أصل واحد',two:'أصلان',few:'أصول',many:'أصلًا',other:'أصل'},
 facility:{zero:'لا منشآت',one:'منشأة واحدة',two:'منشأتان',few:'منشآت',many:'منشأةً',other:'منشأة'},
 company:{zero:'لا شركات',one:'شركة واحدة',two:'شركتان',few:'شركات',many:'شركةً',other:'شركة'},
 employee:{zero:'لا موظفين',one:'موظف واحد',two:'موظفان',few:'موظفين',many:'موظفًا',other:'موظف'},
 route:{zero:'لا مسارات',one:'مسار واحد',two:'مساران',few:'مسارات',many:'مسارًا',other:'مسار'},
 trip:{zero:'لا رحلات',one:'رحلة واحدة',two:'رحلتان',few:'رحلات',many:'رحلةً',other:'رحلة'},
 project:{zero:'لا مشاريع',one:'مشروع واحد',two:'مشروعان',few:'مشاريع',many:'مشروعًا',other:'مشروع'},
 branch:{zero:'لا فروع',one:'فرع واحد',two:'فرعان',few:'فروع',many:'فرعًا',other:'فرع'},
 vehicle:{zero:'لا مركبات',one:'مركبة واحدة',two:'مركبتان',few:'مركبات',many:'مركبةً',other:'مركبة'},
 attendee:{zero:'لا حضور',one:'حاضر واحد',two:'حاضران',few:'حضور',many:'حاضرًا',other:'حاضر'},
 viewer:{zero:'لا مشاهدات',one:'مشاهدة واحدة',two:'مشاهدتان',few:'مشاهدات',many:'مشاهدةً',other:'مشاهدة'}
});
const formatNumber=value=>Math.max(0,Math.round(Number(value)||0)).toLocaleString('ar-SA-u-nu-latn');
function category(value){const n=Math.abs(Math.trunc(Number(value)||0)),mod100=n%100;if(n===0)return'zero';if(n===1)return'one';if(n===2)return'two';if(mod100>=3&&mod100<=10)return'few';if(mod100>=11&&mod100<=99)return'many';return'other';}
function count(value,noun,{showZero=true}={}){const n=Math.max(0,Math.round(Number(value)||0)),forms=FORMS[noun];if(!forms)throw new Error(`arabic-copy-noun-unknown:${noun}`);const kind=category(n);if(kind==='zero')return showZero?forms.zero:'';if(kind==='one'||kind==='two')return forms[kind];return `${formatNumber(n)} ${forms[kind]}`;}
function join(items,{conjunction='و'}={}){const rows=(items||[]).map(value=>String(value||'').trim()).filter(Boolean);if(rows.length<2)return rows[0]||'';return `${rows.slice(0,-1).join('، ')} ${conjunction}${rows.at(-1)}`;}
function readingDuration(lines,{wordsPerMinute=125,minMs=2500,maxMs=18000}={}){const words=(Array.isArray(lines)?lines:[lines]).join(' ').trim().split(/\s+/u).filter(Boolean).length;return Math.max(minMs,Math.min(maxMs,Math.round(words/Math.max(60,Number(wordsPerMinute)||125)*60000)));}
const API=Object.freeze({VERSION,FORMS,category,count,join,formatNumber,readingDuration});
globalThis.GH_ARABIC_COPY=API;if(globalThis.window&&window!==globalThis)window.GH_ARABIC_COPY=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
