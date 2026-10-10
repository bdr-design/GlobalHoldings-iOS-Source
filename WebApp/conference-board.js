/* Build 327: one read-only data document, two render targets (accessible HTML / 3D LED). */
(()=>{'use strict';
const M=globalThis.GH_CONF_MODEL,{esc,number,int,usable,annualGrowth}=M;
const COLORS={ink:'#142238',muted:'#556579',blue:'#245bdb',teal:'#087e78',red:'#b33c42',line:'#dce3ec',paper:'#f7f9fc'};
function safeLogo(value){const logo=String(value||''),inspect=globalThis.GH_IDENTITY?.inspectCustomLogo;return logo&&typeof inspect==='function'&&inspect(logo).ok?logo:'';}
function amount(v){const n=number(v),a=Math.abs(n);return a>=1e9?{value:(n/1e9).toLocaleString('en-US',{maximumFractionDigits:2}),unit:'مليار دولار'}:a>=1e6?{value:(n/1e6).toLocaleString('en-US',{maximumFractionDigits:2}),unit:'مليون دولار'}:{value:int(n),unit:'دولار'};}
const companyCount=n=>n===1?'شركة واحدة':n===2?'شركتان':n<=10?`${int(n)} شركات`:`${int(n)} شركة`;
function documentFor(snapshot,scene){
 const g=snapshot.group||{},companies=snapshot.companies||[],company=companies.find(c=>c.type===scene.type),row=company||g;
 const totalHeadcount=number(g.headcount)+companies.reduce((sum,c)=>sum+number(c.headcount),0);
 const doc={...scene,year:snapshot.year,eyebrow:scene.title,title:scene.headline,unit:scene.subtitle,numeric:false,stats:scene.metrics,series:[],chartTitle:'',note:scene.caption,exact:null,logo:scene.logo};
 if(scene.kind==='finance'){
  doc.title='النتائج المالية';doc.unit=`الفترة ${snapshot.year||'الحالية'}`;doc.numeric=false;doc.exact=null;
  const totalDays=Number(row.expectedDays)||0,reportedDays=Number(row.reportedDays)||0,ratio=totalDays>0?Math.max(0,Math.min(100,reportedDays/totalDays*100)):null,margin=number(row.grossRevenue)>0?number(row.net)/number(row.grossRevenue)*100:null,growth=annualGrowth(row,'revenue',snapshot.year);
  doc.summary={revenue:number(row.grossRevenue),expenses:number(row.expenses),net:number(row.net),reportedDays,expectedDays:totalDays,coverage:ratio,margin,growth,complete:!!row.complete,quality:row.dataQuality?.status||'empty',qualityReason:row.dataQuality?.reason||'',ops:company?.ops||null,group:!company,companyCount:companies.length,groupHeadcount:number(g.headcount),groupFacilities:companies.reduce((n,c)=>n+number(c.facilities),0),opsAsOfDay:company?.opsAsOfDay||null};
  doc.heroLabel='ملخص الفترة المالية';doc.chartTitle='الأرقام من الإقفالات المالية المسجلة';
  doc.list=usable(row)?[
   {label:'الإيرادات المسجلة',value:`${amount(row.grossRevenue).value} ${amount(row.grossRevenue).unit}`},
   {label:'المصروفات المسجلة',value:`${amount(row.expenses).value} ${amount(row.expenses).unit}`},
   {label:row.net<0?'صافي الخسارة':'صافي الربح',value:`${amount(row.net).value} ${amount(row.net).unit}`},
   annualGrowth(row,'revenue',snapshot.year)!=null?{label:'نمو الإيرادات · مقارنة بفترتين مكتملتين',value:`${number(annualGrowth(row,'revenue',snapshot.year))>0?'+':''}${number(annualGrowth(row,'revenue',snapshot.year)).toFixed(1)}%`}:row.complete&&number(row.grossRevenue)>0?{label:'هامش صافي الفترة',value:`${(number(row.net)/number(row.grossRevenue)*100).toFixed(1)}%`}:{label:'تغطية الإقفال · المسجل / المتوقع',value:row.expectedDays?`${int(row.reportedDays)} / ${int(row.expectedDays)} يومًا`:int(row.reportedDays)}
  ]:[];
  doc.stats=[];doc.note=usable(row)?'المصدر: الإقفالات المالية اليومية المسجلة داخل اللعبة. لا تُقدّر القيم غير المتاحة.':row.dataQuality?.reason||'لا توجد إقفالات مالية معتمدة لهذه الفترة.';
 }else if(scene.kind==='opening'){
  doc.title=String(snapshot.year);doc.numeric=true;doc.heroLabel='المؤتمر التنفيذي السنوي';doc.unit=g.name||'Global Holdings';doc.chartTitle='نطاق المؤتمر';doc.list=[{label:'الشركات المشاركة',value:`${int(companies.length)} شركة`},{label:'الموظفون',value:`${int(totalHeadcount)} موظف`},{label:'سنة العرض',value:String(snapshot.year)}];doc.stats=[];
 }else if(scene.kind==='closing'){
  doc.title='الفصل القادم';doc.unit=g.name||'Global Holdings';doc.chartTitle='الأولويات التنفيذية';doc.list=[{label:'شركات المجموعة',value:companies.length?companyCount(companies.length):''},{label:'الموظفون',value:totalHeadcount?`${int(totalHeadcount)} موظف`:''},{label:'الأولوية التنفيذية',value:g.priority||'لم تعتمد بعد'}];doc.stats=[];
 }else if(scene.kind==='portfolio'){
  doc.title='أعمال متنوعة.\nرؤية واحدة.';doc.unit='محفظة المجموعة';doc.series=companies.filter(c=>usable(c)&&c.complete).map(c=>({label:c.legalName||c.type,value:number(c.net),color:number(c.net)<0?COLORS.red:COLORS.blue}));doc.chartTitle='صافي نتائج الشركات ذات الفترات المكتملة';doc.stats=[];
 }else if(scene.kind==='people'){
  doc.title=int(totalHeadcount);doc.unit='موظف في المجموعة';doc.numeric=true;doc.series=companies.map(c=>({label:c.legalName||c.type,value:number(c.headcount),color:COLORS.blue}));if(number(g.headcount)>0)doc.series.push({label:'الإدارة القابضة',value:number(g.headcount),color:COLORS.blue});doc.chartTitle='توزيع الموظفين';doc.chartUnit='موظف';doc.stats=[];
 }else if(scene.kind==='outlook'){
  doc.title=String(Number(snapshot.year)+1);doc.numeric=true;doc.unit='المرحلة القادمة';doc.chartTitle='خطة العام المقبل';doc.list=scene.metrics;doc.stats=[];
 }else if(scene.kind==='audience'){
  doc.title=int(snapshot.social?.viewers);doc.numeric=true;doc.unit='مشاهدة داخل عالم اللعبة';doc.chartTitle='مؤشرات التفاعل المحاكي';doc.list=scene.metrics;doc.stats=[];
 }else if(scene.kind==='leadership'){
  doc.title=scene.presenter;doc.unit=scene.role;doc.chartTitle='الشركة في أرقام';doc.list=scene.metrics;doc.stats=[];
 }else if(scene.kind==='customers'){
  doc.title=scene.title||scene.headline||'صوت العميل';doc.unit='';doc.heroLabel='تجربة العملاء';doc.chartTitle='مؤشرات تجربة العملاء';doc.list=scene.metrics;doc.stats=[];
 }else if(scene.kind==='operations'){
  doc.title='الأداء التشغيلي';doc.unit=scene.subtitle;doc.chartTitle='مؤشرات التشغيل';doc.list=scene.metrics;doc.stats=[];
 }else if(scene.kind==='achievements'){
  doc.title='إنجازات العام';doc.unit='إنجازات مسجلة';doc.chartTitle='حصيلة العام';doc.list=scene.metrics;doc.stats=[];
 }
 if(!doc.series.length&&!doc.list&&scene.metrics?.length){doc.title=scene.headline||scene.title;doc.unit=scene.subtitle||'';doc.chartTitle=scene.title;doc.list=scene.metrics;doc.stats=[];}
 if(!doc.series.length&&!doc.list)doc.empty=scene.kind==='finance'?(row.dataQuality?.reason||'لا توجد إقفالات مالية معتمدة لهذه الفترة.'):'تظهر المقارنة بعد تسجيل إقفالات مالية للشركات.';
 return tidy(doc,scene);
}
// Presentation pass (owner review, Build 358: "the conference is a mess"). The plan and its hash are untouched; only
// what reaches the screen changes: placeholders ("—", "لم يعتمد", "غير متاح") never stand in as values, raw
// "28,981,812 USD" amounts read as "28.98 مليون دولار", simulated comments in other languages stay in the archive but
// are not put on an Arabic screen, and a chapter whose facts are all pending says so once instead of listing dashes.
const MISSING=/^(?:[—–\-\s]*|لم (?:يعتمد|تعتمد)(?: بعد)?|غير متاح|بيانات غير مكتملة)$/;
const missing=value=>value==null||MISSING.test(String(value).trim());
function readable(value){const swap=n=>{const a=amount(Number(String(n).replace(/,/g,'')));return `${a.value} ${a.unit}`;};return String(value??'').trim().replace(/USD\s+(-?[\d,]+(?:\.\d+)?)|(-?[\d,]+(?:\.\d+)?)\s+USD/g,(_,a,b)=>swap(a??b));}
const arabic=text=>/[\u0600-\u06FF]/.test(String(text||''));
const PENDING={outlook:['لم تُعتمد خطة العام المقبل بعد','حدّد الأولويات التنفيذية من لوحة الإدارة لتظهر هنا.'],closing:['الأولويات قيد الإعداد','تظهر الأولويات التنفيذية بعد اعتمادها من الإدارة.']};
function splitAmount(value){const text=readable(value),m=/^(-?[\d.,]+%?)\s+(.+)$/.exec(text);return m&&/[\u0600-\u06FF]/.test(m[2])?{value:m[1],unit:m[2]}:{value:text,unit:''};}
function tidy(doc,scene){
 doc.stats=(doc.stats||[]).filter(m=>!missing(m.value)).map(m=>({label:m.label,...splitAmount(m.value)}));
 if(missing(doc.unit)||doc.unit===doc.title)doc.unit='';
 if(/[:：]\s*(?:[—–-]|لم (?:يعتمد|تعتمد)(?: بعد)?)\s*$/.test(String(doc.note||'')))doc.note='';
 if(doc.list){
  const quotes=[],facts=[];
  for(const item of doc.list){
   if(String(item.id||'').startsWith('comment-')){if(arabic(item.value)&&!missing(item.value))quotes.push({label:String(item.label||'').split('·')[0].trim(),value:String(item.value)});continue;}
   if(!missing(item.value))facts.push({label:item.label,value:readable(item.value)});
  }
  doc.list=facts.length?facts:null;doc.quotes=quotes.slice(0,2);
  if(!doc.list&&!doc.quotes.length&&!doc.series.length){const [title,hint]=PENDING[scene.kind]||['لا توجد بيانات مكتملة بعد','تظهر التفاصيل بعد تسجيلها في أنظمة المجموعة.'];doc.emptyTitle=title;doc.empty=hint;}
 }
 if(doc.series.length===1&&scene.kind==='portfolio')doc.chartTitle='صافي نتيجة الشركة';
 return doc;
}
function domain(series){const values=series.map(x=>number(x.value));return{min:Math.min(0,...values),max:Math.max(0,...values)||1};}
function graphHTML(doc){
 const quotes=doc.quotes?.length?`<div class="ghc3-quotes">${doc.quotes.map(q=>`<blockquote><p>${esc(q.value)}</p><cite dir="ltr">${esc(q.label)}</cite></blockquote>`).join('')}</div>`:'';
 if(doc.list){const facts=doc.list.slice(0,4),current=['customers','operations','leadership'].includes(doc.kind),reference=current?'لقطة وقت إعداد المؤتمر':'سجلات هذه الشريحة',basis=doc.kind==='customers'?'سجلات دورة العملاء · لا نتائج استبيان':doc.kind==='operations'?'مؤشرات حالة وليست حصيلة سنوية':doc.kind==='leadership'?'بيانات الإدارة الحالية':'بيانات النظام المسجلة';while(facts.length>0&&facts.length<4)facts.push({label:facts.length===3?'مرجع البيانات':'طبيعة القياس',value:facts.length===3?reference:basis});return `<div class="ghc3-facts" data-count="${facts.length}" data-total="${doc.list.length}" data-source="${esc(doc.id||doc.templateId||'conference-scene')}">${facts.map((x,i)=>`<div class="ghc3-fact ghc3-fact-${i+1}"><small>${esc(x.label)}</small><b dir="auto">${esc(x.value)}</b></div>`).join('')}</div>${quotes}`;}
 if(quotes&&!doc.series.length)return quotes;
 if(!doc.series.length)return `<div class="ghc3-empty"><span aria-hidden="true"></span><b>${esc(doc.emptyTitle||'لا توجد بيانات مكتملة بعد')}</b><p>${esc(doc.empty)}</p></div>`;
 const series=doc.series.slice().sort((a,b)=>number(b.value)-number(a.value)).slice(0,4),list=series.map(x=>({label:x.label,value:doc.chartUnit?`${int(x.value)} ${doc.chartUnit}`:`${amount(x.value).value} ${amount(x.value).unit}`}));if(doc.series.length>4)doc.chartTitle='أعلى أربع نتائج مسجلة حسب الشركة';const filler=doc.kind==='people'?[{label:'مرجع البيانات',value:'لقطة وقت إعداد المؤتمر'},{label:'مصدر البيانات',value:'سجلات الموارد البشرية'}]:[{label:'الفترة المرجعية',value:`${doc.year||'الفترة المعروضة'}`},{label:'مصدر المقارنة',value:'الإقفالات المالية المسجلة'}];while(list.length>0&&list.length<4)list.push(filler[list.length-2]||{label:'نطاق المقارنة',value:'السجلات المتاحة'});
 return `<div class="ghc3-facts ghc3-facts-series" data-count="${list.length}" data-total="${doc.series.length}" data-source="conference-series">${list.map((x,i)=>`<div class="ghc3-fact ghc3-fact-${i+1}"><small>${esc(x.label)}</small><b dir="auto">${esc(x.value)}</b></div>`).join('')}</div>`;
}
function identityFor(snapshot,scene){
 const type=String(scene.type||'group'),owner=type==='group'?(snapshot.group||{}):(snapshot.companies||[]).find(row=>row.type===type)||{};
 return {name:String(owner.legalName||owner.name||(type==='group'?'Global Holdings':type)),shortName:String(owner.shortName||owner.brand?.shortName||scene.type||'GH'),logo:safeLogo(scene.logo||owner.brand?.logo),markLogo:safeLogo(owner.brand?.variants?.mark),type,year:String(snapshot.year||'')};
}
function statsHTML(stats){return stats?.length?`<div class="ghc3-stats" data-count="${stats.length}">${stats.map(m=>`<div><b dir="auto">${esc(m.value)}${m.unit?`<small>${esc(m.unit)}</small>`:''}</b><span>${esc(m.label)}</span></div>`).join('')}</div>`:'';}
function compactMoney(value){const part=amount(value);return `${part.value} ${part.unit}`;}
const OPS_LABELS={assetCount:'الأصول',activeAssets:'أصول عاملة',routeCount:'المسارات',tripCount:'الرحلات',generationMW:'قدرة التوليد',storageMWh:'التخزين',projects:'المشاريع',branches:'الفروع',branchCount:'الفروع',corporateClients:'عملاء الشركات',liquidity:'السيولة',vehicles:'المركبات',activeVehicles:'مركبات عاملة',drivers:'السائقون',centers:'المراكز',customerCount:'العملاء',activeSubscriptions:'اشتراكات نشطة',activeServicePlans:'خطط خدمة نشطة',policies:'الوثائق',offices:'المكاتب',lossRatio:'نسبة الخسائر',lossRatio30:'نسبة الخسائر',premium30:'أقساط آخر 30 يومًا',claims30:'مطالبات آخر 30 يومًا',units:'الوحدات',occupancy:'الإشغال',rentRoll:'الإيجار السنوي'};
function operationRows(summary){
 if(summary.group)return [{label:'الشركات المفتوحة',value:int(summary.companyCount)},{label:'الموظفون',value:int(summary.groupHeadcount)},{label:'المنشآت',value:int(summary.groupFacilities)}];
 const ops=summary.ops||{},rows=[];
 for(const [key,value] of Object.entries(ops)){
  if(!Number.isFinite(Number(value))||Number(value)<=0||['activeAssets'].includes(key))continue;
  let formatted;if(['liquidity','premium30','claims30','rentRoll'].includes(key))formatted=compactMoney(value);else if(['generationMW','storageMWh'].includes(key))formatted=`${int(value)} ${key==='generationMW'?'MW':'MWh'}`;else if(['lossRatio','lossRatio30','occupancy'].includes(key))formatted=`${(Number(value)*(Math.abs(Number(value))<=1?100:1)).toFixed(1)}%`;else formatted=int(value);
  rows.push({label:OPS_LABELS[key]||key,value:formatted});if(rows.length===3)break;
 }
 return rows;
}
function summaryBoardHTML(d,identity,logo,mark,kind,template){
 const s=d.summary||{},ready=s.reportedDays>0&&s.quality!=='error',financial=[['الإيرادات',s.revenue,'#29c9c1'],['المصروفات',s.expenses,'#a58cf3'],[s.net<0?'صافي الخسارة':'صافي النتيجة',s.net,'#f1c86f']],max=Math.max(1,...financial.map(([,v])=>Math.abs(number(v)))),facts=operationRows(s),quality=s.quality==='ok'?'مطابقة':s.quality==='warning'?'تحتاج مراجعة':s.quality==='error'?'خطأ':'لا توجد إقفالات',qualityTone=s.quality==='ok'?'ok':s.quality==='warning'?'warn':'muted',growth=s.growth==null?null:`${number(s.growth)>0?'+':''}${number(s.growth).toFixed(1)}%`,meta=[{label:'أيام الإقفال',value:s.expectedDays?`${int(s.reportedDays)} / ${int(s.expectedDays)}`:int(s.reportedDays)},{label:'التغطية',value:s.coverage==null?'—':`${s.coverage.toFixed(0)}%`},{label:'سلامة السجل',value:quality}];
 const financeHTML=financial.map(([label,value,color])=>`<div class="ghcb-finance-line"><div><small>${esc(label)}</small><b dir="auto">${ready?esc(compactMoney(value)):'—'}</b></div><span class="ghcb-finance-track"><i style="width:${ready?Math.max(0,Math.min(100,Math.abs(number(value))/max*100)):0}%;background:${color}"></i></span></div>`).join('');
 const opsHTML=facts.length?facts.map(row=>`<div class="ghcb-mini-metric"><small>${esc(row.label)}</small><b dir="auto">${esc(row.value)}</b></div>`).join(''):`<p class="ghcb-summary-empty">لا توجد مؤشرات تشغيل مسجلة</p>`;
 const logoHTML=logo?`<img class="ghc3-board-logo" src="${esc(logo)}" data-mark-src="${esc(identity.markLogo)}" alt="شعار ${esc(identity.name)}">`:`<b class="ghc3-board-logo-mark" aria-hidden="true">${esc(mark)}</b>`;
 const asOf=s.opsAsOfDay==null?'لقطة إعداد المؤتمر':`لقطة التشغيل الحالية · اليوم ${int(s.opsAsOfDay)}`;
 return `<article class="ghc3-board ghc3-board-${kind} ghc3-template-${template} ghcb-summary-board" data-template="${esc(template)}" data-summary-source="annual-close-and-current-ops"><header class="ghcb-summary-header"><span class="ghcb-summary-period"><b dir="ltr">${esc(d.year||'—')}</b><small>${s.complete?'سنة مكتملة':'الفترة المسجلة'}</small></span><h1>ملخص الأداء</h1><div class="ghcb-summary-company"><span class="ghcb-summary-logo">${logoHTML}</span><b>${esc(identity.name)}</b></div></header><div class="ghcb-summary-grid"><section class="ghcb-summary-panel ghcb-summary-finance"><header><small>02 · FINANCIALS</small><h2>الملخص المالي</h2></header><div class="ghcb-finance-lines">${financeHTML}</div></section><section class="ghcb-summary-panel ghcb-summary-net"><header><small>01 · NET RESULT</small><h2>النتيجة الرئيسية</h2></header><b class="ghcb-net-value ${s.net<0?'is-negative':''}" dir="auto">${ready?esc(compactMoney(s.net)):'قيد المراجعة'}</b><div class="ghcb-net-meta"><span>${s.margin==null?'هامش غير متاح':`هامش صافي ${s.margin.toFixed(1)}%`}</span>${growth?`<span>نمو الإيراد ${esc(growth)}</span>`:''}</div><p>${ready?(s.complete?'نتيجة سنة مكتملة من الإقفالات اليومية.':'نتيجة الفترة المسجلة حتى الآن.'):(s.qualityReason||'لا توجد بيانات مالية معتمدة للفترة.')}</p></section><section class="ghcb-summary-panel ghcb-summary-quality"><header><small>04 · DATA QUALITY</small><h2>تغطية البيانات</h2></header><div class="ghcb-summary-metrics">${meta.map((x,i)=>`<div class="ghcb-mini-metric ${i===2?`tone-${qualityTone}`:''}"><small>${esc(x.label)}</small><b dir="auto">${esc(x.value)}</b></div>`).join('')}</div><p>مرجع مالي: سجل الإقفالات اليومية</p></section><section class="ghcb-summary-panel ghcb-summary-ops"><header><small>03 · OPERATIONS</small><h2>مؤشرات التشغيل</h2></header><div class="ghcb-summary-metrics">${opsHTML}</div><p>${asOf}</p></section></div><p class="ghc3-board-note">المصدر المالي: الإقفالات اليومية المسجلة · التشغيل: لقطة حالية عند إعداد المؤتمر</p></article>`;
}
function sceneFactsHTML(d){
 const rows=d.list?.length?d.list.slice(0,4):d.series?.slice(0,4).map(row=>({label:row.label,value:d.chartUnit?`${int(row.value)} ${d.chartUnit}`:`${amount(row.value).value} ${amount(row.value).unit}`}))||[];
 if(d.kind==='customers'&&rows.length===3)rows.push({label:'مرجع البيانات',value:'لقطة إعداد المؤتمر'});
 if(rows.length)return `<div class="ghcb-content-facts" data-count="${rows.length}" data-total="${d.list?.length||d.series?.length||rows.length}">${rows.map((row,index)=>`<div class="ghcb-content-fact ghcb-content-fact-${index+1}"><small>${esc(row.label)}</small><b dir="auto">${esc(row.value)}</b></div>`).join('')}</div>`;
 if(d.empty)return `<div class="ghcb-content-empty"><b>${esc(d.emptyTitle||'لا توجد بيانات مكتملة بعد')}</b><p>${esc(d.empty)}</p></div>`;
 return `<div class="ghcb-content-empty"><b>لا توجد مؤشرات إضافية</b><p>يعرض هذا الفصل البيانات المسجلة المتاحة فقط.</p></div>`;
}
function sceneBoardHTML(d,identity,logo,mark,kind,template){
 const rawTitle=String(d.title||''),identityName=String(identity.name||''),displayTitle=identityName&&rawTitle.startsWith(identityName)?rawTitle.slice(identityName.length).replace(/^\s*[·—:-]\s*/,'').trim():rawTitle,compactLogo=safeLogo(identity.markLogo)||logo,logoHTML=compactLogo?`<img class="ghc3-board-logo" src="${esc(compactLogo)}" data-mark-src="${esc(identity.markLogo)}" alt="شعار ${esc(identity.name)}">`:`<b class="ghc3-board-logo-mark" aria-hidden="true">${esc(mark)}</b>`,quotes=d.quotes?.length?d.quotes.slice(0,2).map(row=>`<blockquote class="ghcb-content-quote"><p>${esc(row.value)}</p><cite dir="ltr">${esc(row.label)}</cite></blockquote>`).join(''):'',stats=d.stats?.length?d.stats.slice(0,3).map(row=>`<div class="ghcb-content-mini"><small>${esc(row.label)}</small><b dir="auto">${esc(row.value)}${row.unit?` ${esc(row.unit)}`:''}</b></div>`).join(''):'',note=d.note||d.empty||'تظهر البيانات المسجلة المتاحة وقت إعداد المؤتمر.',contextTitle=d.emptyTitle||(d.kind==='customers'?'طبيعة القياس':'ملاحظة الفصل'),reference=d.kind==='customers'?'سجلات دورة العملاء؛ لا نتائج استبيان':`لقطة محفوظة وقت إعداد المؤتمر · ${d.year||identity.year||''}`;
 return `<article class="ghc3-board ghc3-board-${kind} ghc3-template-${template} ghcb-summary-board ghcb-scene-board" data-template="${esc(template)}" data-scene-source="${esc(d.id||d.templateId||'conference-snapshot')}"><header class="ghcb-summary-header"><span class="ghcb-summary-period"><b dir="ltr">${esc(d.year||identity.year||'—')}</b><small>سنة العرض</small></span><h1>${esc(d.chartTitle||d.heroLabel||'عرض المؤتمر')}</h1><div class="ghcb-summary-company"><span class="ghcb-summary-logo">${logoHTML}</span><b>${esc(identity.name)}</b></div></header><div class="ghcb-summary-grid ghcb-scene-grid"><section class="ghcb-summary-panel ghcb-scene-hero"><header><small>01 · ${esc(String(d.kind||'STORY').toUpperCase())}</small><h2>${esc(d.heroLabel||d.eyebrow||'محور العرض')}</h2></header><strong class="ghcb-scene-title ${d.numeric?'is-numeric':''}" ${d.numeric?'dir="auto"':''}>${esc(displayTitle||rawTitle)}</strong><p class="ghcb-scene-unit">${esc(d.unit||'')}</p>${stats?`<div class="ghcb-scene-stats">${stats}</div>`:''}</section><section class="ghcb-summary-panel ghcb-scene-metrics"><header><small>02 · KEY DATA</small><h2>${esc(d.chartTitle||'المؤشرات الرئيسية')}</h2></header>${sceneFactsHTML(d)}</section><section class="ghcb-summary-panel ghcb-scene-context"><header><small>03 · ${quotes?'CUSTOMER VOICE':'CONTEXT'}</small><h2>${quotes?'صوت وملاحظات':'سياق الفصل'}</h2></header>${quotes?`<div class="ghcb-scene-quotes">${quotes}</div>`:`<div class="ghcb-scene-context-copy"><b>${esc(contextTitle)}</b><p>${esc(note)}</p></div>`}</section><section class="ghcb-summary-panel ghcb-scene-source"><header><small>04 · REFERENCE</small><h2>نطاق البيانات</h2></header><div class="ghcb-scene-context-copy"><b>${esc(d.heroLabel||d.eyebrow||'لقطة المؤتمر')}</b><p>${esc(reference)}</p></div><p>${esc(d.kind||'conference')} · ${esc(d.year||identity.year||'')}</p></section></div><p class="ghc3-board-note">${esc(d.kind||'conference')} · ${esc(d.year||identity.year||'')}</p></article>`;
}
class Board{
 constructor(element){this.element=element;this.images=new Map();this.disposed=false;}
 update(snapshot,scene){this.doc=documentFor(snapshot,scene);const d=this.doc,identity=identityFor(snapshot,scene);
  const template=String(scene.templateId||'statement').replace(/[^a-z0-9_-]/gi,'').slice(0,48)||'statement',kind=String(scene.kind||'statement').replace(/[^a-z0-9_-]/gi,'').slice(0,48)||'statement',logo=identity.logo,mark=Array.from(identity.shortName.replace(/\s+/gu,'')).slice(0,2).join('')||'GH';
  this.element.innerHTML=d.kind==='finance'?summaryBoardHTML(d,identity,logo,mark,kind,template):sceneBoardHTML(d,identity,logo,mark,kind,template);
 }
 text(ctx,text,x,y,width,size,color=COLORS.ink,weight=400,align='right'){
  let s=size;ctx.textAlign=align;ctx.direction=/^[+\-\d][\d,.\s]*$/.test(String(text))?'ltr':'rtl';ctx.fillStyle=color;const set=()=>{ctx.font=`${weight} ${s}px "GH Plex Arabic",sans-serif`;};set();
  while(ctx.measureText(String(text)).width>width&&s>size*.65){s-=1;set();}
  let value=String(text);while(value.length&&ctx.measureText(value).width>width)value=value.slice(0,-1);if(value!==String(text))value=value.slice(0,-1)+'…';ctx.fillText(value,x,y);
 }
 lines(ctx,text,x,y,width,size,color=COLORS.ink,weight=400,maxLines=2){
  ctx.font=`${weight} ${size}px "GH Plex Arabic",sans-serif`;
  const words=String(text).split(/\s+/),lines=[];let line='';
  for(const word of words){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>width){lines.push(line);line=word;}else line=next;}
  if(line)lines.push(line);lines.slice(0,maxLines).forEach((v,i)=>this.text(ctx,v+(i===maxLines-1&&lines.length>maxLines?'…':''),x,y+i*size*1.45,width,size,color,weight));
 }
 draw(canvas,onLoad){
  if(this.disposed||!this.doc)return;const ctx=canvas.getContext('2d'),d=this.doc,W=2400,H=1080;
  ctx.save();ctx.scale(canvas.width/W,canvas.height/H);ctx.fillStyle='#edf2f8';ctx.fillRect(0,0,W,H);
  const panel=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,20);ctx.fill();};
  this.text(ctx,d.eyebrow,2310,99,1910,52,COLORS.ink,500);this.text(ctx,String(d.year),90,99,210,38,COLORS.blue,500,'left');
  ctx.fillStyle=COLORS.blue;ctx.fillRect(2334,60,7,50);
  panel(65,155,1360,814,'#ffffff');panel(1455,155,880,814,'#f7f9fc');
  this.text(ctx,d.chartTitle,1350,240,1190,43,COLORS.ink,500);
  ctx.fillStyle=COLORS.line;ctx.fillRect(140,275,1210,2);
  {const logo=safeLogo(d.logo);if(logo){let img=this.images.get(logo);if(!img){img=new Image();this.images.set(logo,img);img.onload=()=>{if(!this.disposed)onLoad?.();};img.src=logo;}if(img.complete&&img.naturalWidth){const scale=Math.min(95/img.naturalWidth,65/img.naturalHeight);ctx.drawImage(img,1510,186,img.naturalWidth*scale,img.naturalHeight*scale);}}}
  if(d.heroLabel)this.text(ctx,d.heroLabel,2265,280,720,40,COLORS.muted,400);
  if(d.numeric)this.text(ctx,d.title,2265,470,720,145,COLORS.ink,600);
  else this.lines(ctx,d.title,2265,410,730,82,COLORS.ink,600,2);
  this.lines(ctx,d.unit,2265,605,730,39,COLORS.muted,400,2);
  const stats=d.stats.slice(0,3),gap=720/Math.max(1,stats.length);
  stats.forEach((s,i)=>{const x=2265-i*gap;this.text(ctx,s.unit?`${s.value} ${s.unit}`:s.value,x,792,gap-22,48,COLORS.ink,500);this.lines(ctx,s.label,x,856,gap-22,31,COLORS.muted,400,2);});
  const quotes=d.quotes||[];
  if(d.list){const rows=d.list.slice(0,5),room=quotes.length?440:640,gap=Math.min(200,room/Math.max(1,rows.length));rows.forEach((s,i)=>{const y=340+i*gap;panel(132,y-38,1225,gap-20,'#f5f8fc');ctx.fillStyle=COLORS.teal;ctx.fillRect(1335,y-38+18,6,gap-56);this.text(ctx,s.label,1300,y+12,1100,34,COLORS.muted);this.lines(ctx,s.value,1300,y+72,1120,rows.length>3?44:56,COLORS.ink,600,1);});}
  if(quotes.length){const top=d.list?820:360,gap=d.list?0:250;quotes.slice(0,d.list?1:2).forEach((q,i)=>{const y=top+i*gap;panel(132,y-50,1225,gap?gap-30:150,'#f3f7f6');this.lines(ctx,`«${q.value}»`,1300,y+10,1120,44,COLORS.ink,500,2);this.text(ctx,q.label,190,y+(gap?150:80),600,30,COLORS.muted,400,'left');});}
  else if(d.series.length){const scale=domain(d.series),span=scale.max-scale.min,left=142,right=1348,bw=right-left,zero=left-scale.min/span*bw,gap=Math.min(195,618/d.series.length),dense=d.series.length>4;
   d.series.forEach((s,i)=>{const y=350+i*gap;this.text(ctx,s.label,right,y,755,dense?34:43,COLORS.muted);this.text(ctx,d.chartUnit?int(s.value):amount(s.value).value+' '+amount(s.value).unit,left,y,415,dense?34:40,COLORS.ink,500,'left');ctx.fillStyle='#eaf0f7';ctx.fillRect(left,y+25,bw,dense?20:30);ctx.fillStyle=s.color;ctx.fillRect(left+(Math.min(0,s.value)-scale.min)/span*bw,y+25,Math.abs(s.value)/span*bw,dense?20:30);ctx.fillStyle='#718198';ctx.fillRect(zero,y+20,2,dense?30:40);});
  }else if(!d.list&&!quotes.length){this.text(ctx,d.emptyTitle||'بانتظار البيانات المعتمدة',1345,495,1190,64,COLORS.ink,500);this.lines(ctx,d.empty||'',1345,584,1190,40,COLORS.muted,400,3);}
  this.text(ctx,d.note,2310,1030,2220,32,COLORS.muted);ctx.restore();
 }
 dispose(){this.disposed=true;for(const img of this.images.values())img.onload=null;this.images.clear();this.element.replaceChildren();}
}
globalThis.GH_CONF_BOARD=Object.freeze({Board,documentFor,amount,domain,COLORS});
})();
