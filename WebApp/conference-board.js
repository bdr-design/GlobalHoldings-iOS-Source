/* Build 327: one read-only data document, two render targets (accessible HTML / 3D LED). */
(()=>{'use strict';
const M=globalThis.GH_CONF_MODEL,{esc,number,int,usable,annualGrowth}=M;
const COLORS={ink:'#142238',muted:'#556579',blue:'#245bdb',teal:'#087e78',red:'#b33c42',line:'#dce3ec',paper:'#f7f9fc'};
function safeLogo(value){const logo=String(value||''),inspect=globalThis.GH_IDENTITY?.inspectCustomLogo;return logo&&typeof inspect==='function'&&inspect(logo).ok?logo:'';}
function amount(v){const n=number(v),a=Math.abs(n);return a>=1e9?{value:(n/1e9).toLocaleString('en-US',{maximumFractionDigits:2}),unit:'مليار دولار'}:a>=1e6?{value:(n/1e6).toLocaleString('en-US',{maximumFractionDigits:2}),unit:'مليون دولار'}:{value:int(n),unit:'دولار'};}
function documentFor(snapshot,scene){
 const g=snapshot.group||{},companies=snapshot.companies||[],company=companies.find(c=>c.type===scene.type),row=company||g;
 const totalHeadcount=number(g.headcount)+companies.reduce((sum,c)=>sum+number(c.headcount),0),totalPayroll=number(g.monthlyPayroll)+companies.reduce((sum,c)=>sum+number(c.monthlyPayroll),0);
 const doc={...scene,year:snapshot.year,eyebrow:scene.title,title:scene.headline,unit:scene.subtitle,numeric:false,stats:scene.metrics,series:[],chartTitle:'',note:scene.caption,exact:null,logo:scene.logo};
 if(scene.kind==='finance'){
  doc.title=usable(row)?amount(row.net).value:'النتائج المالية';doc.unit=usable(row)?amount(row.net).unit:'ننتظر الإقفال المالي';doc.numeric=usable(row);doc.exact=usable(row)?M.money(row.net):null;
  doc.heroLabel='صافي نتيجة الفترة';doc.series=usable(row)?[{label:'الإيرادات',value:number(row.grossRevenue),color:COLORS.blue},{label:'المصروفات',value:number(row.expenses),color:'#93a3b8'},{label:row.net<0?'صافي الخسارة':'صافي الربح',value:number(row.net),color:row.net<0?COLORS.red:COLORS.teal}]:[];
  doc.chartTitle='من الإيرادات إلى النتيجة';const growth=annualGrowth(row,'revenue',snapshot.year);
  doc.stats=[{label:'الأيام المسجلة',value:int(row.reportedDays)},{label:'نمو الإيرادات السنوي',value:growth==null?'غير متاح':`${growth>0?'+':''}${Number(growth).toFixed(1)}%`}];
 }else if(scene.kind==='opening'){
  doc.title=String(snapshot.year);doc.numeric=true;doc.heroLabel='المؤتمر التنفيذي السنوي';doc.unit=g.name||'Global Holdings';doc.chartTitle='محاور المؤتمر';doc.list=[{label:'الحصيلة المالية',value:usable(g)?`صافي النتيجة ${M.money(g.net)}`:'النتائج قيد المراجعة'},{label:'محفظة الأعمال',value:`${int(companies.length)} شركات مشاركة`},{label:'المرحلة القادمة',value:g.priority||'لم تعتمد الأولوية بعد'}];doc.stats=[{label:'الشركات المشاركة',value:int(companies.length)},{label:'الموظفون',value:int(totalHeadcount)},{label:'الأيام المالية',value:int(g.reportedDays)}];
 }else if(scene.kind==='closing'){
  doc.title='الفصل القادم';doc.unit=g.name||'Global Holdings';doc.chartTitle='التزامات المرحلة المقبلة';doc.list=[{label:'هدف الإيرادات',value:g.targetRevenue?M.money(g.targetRevenue):'لم يعتمد'},{label:'هامش الربح المستهدف',value:g.targetMargin?`${g.targetMargin}%`:'لم يعتمد'},{label:'الأولوية التنفيذية',value:g.priority||'لم تعتمد'}];doc.stats=[{label:'تفاعل إيجابي',value:`${int(snapshot.social?.positive)}%`},{label:'الحضور',value:int(snapshot.social?.attendees)},{label:'المشاهدات',value:int(snapshot.social?.viewers)}];
 }else if(scene.kind==='portfolio'){
  doc.title='أعمال متنوعة.\nرؤية واحدة.';doc.unit='محفظة المجموعة';doc.series=companies.filter(usable).map(c=>({label:c.legalName||c.type,value:number(c.net),color:number(c.net)<0?COLORS.red:COLORS.blue}));doc.chartTitle='صافي النتائج حسب الشركة';doc.stats=[{label:'شركات المجموعة',value:int(companies.length)},{label:'الموظفون',value:int(totalHeadcount)},{label:'الأيام المسجلة',value:int(g.reportedDays)}];
 }else if(scene.kind==='people'){
  doc.title=int(totalHeadcount);doc.unit='موظف في المجموعة';doc.numeric=true;doc.series=companies.map(c=>({label:c.legalName||c.type,value:number(c.headcount),color:COLORS.blue}));if(number(g.headcount)>0)doc.series.push({label:'الإدارة القابضة',value:number(g.headcount),color:COLORS.blue});doc.chartTitle='توزيع الموظفين';doc.chartUnit='موظف';doc.stats=[{label:'المسير الشهري',value:amount(totalPayroll).value+' '+amount(totalPayroll).unit},{label:'الشركات',value:int(companies.length)}];
 }else if(scene.kind==='outlook'){
  doc.title=String(Number(snapshot.year)+1);doc.numeric=true;doc.unit='المرحلة القادمة';doc.chartTitle='خطة العام المقبل';doc.list=scene.metrics;doc.stats=[];
 }else if(scene.kind==='audience'){
  doc.title=int(snapshot.social?.viewers);doc.numeric=true;doc.unit='مشاهدة داخل عالم اللعبة';doc.chartTitle='مؤشرات التفاعل المحاكي';doc.list=scene.metrics;doc.stats=[];
 }else if(scene.kind==='leadership'){
  doc.title=scene.presenter;doc.unit=scene.role;doc.chartTitle='الشركة في أرقام';doc.list=scene.metrics;doc.stats=[];
 }else if(scene.kind==='operations'){
  doc.title='الأداء التشغيلي';doc.unit=scene.subtitle;doc.chartTitle='مؤشرات التشغيل';doc.list=scene.metrics;doc.stats=[];
 }else if(scene.kind==='achievements'){
  doc.title='إنجازات العام';doc.unit='إنجازات مسجلة';doc.chartTitle='حصيلة العام';doc.list=scene.metrics;doc.stats=[];
 }
 if(!doc.series.length&&!doc.list&&scene.metrics?.length){doc.title=scene.headline||scene.title;doc.unit=scene.subtitle||'';doc.chartTitle=scene.title;doc.list=scene.metrics;doc.stats=[];}
 if(!doc.series.length&&!doc.list)doc.empty=scene.kind==='finance'?(row.dataQuality?.reason||'لا توجد إقفالات مالية معتمدة لهذه الفترة.'):'تظهر المقارنة بعد تسجيل إقفالات مالية للشركات.';
 return doc;
}
function domain(series){const values=series.map(x=>number(x.value));return{min:Math.min(0,...values),max:Math.max(0,...values)||1};}
function graphHTML(doc){
 if(doc.list)return `<div class="ghc3-facts">${doc.list.map((x,i)=>`<div><span class="ghc3-fact-index">${String(i+1).padStart(2,'0')}</span><span><small>${esc(x.label)}</small><b dir="auto">${esc(x.value)}</b></span></div>`).join('')}</div>`;
 if(!doc.series.length)return `<div class="ghc3-empty"><span aria-hidden="true">—</span><b>لا توجد بيانات مكتملة بعد</b><p>${esc(doc.empty)}</p></div>`;
 const d=domain(doc.series),span=d.max-d.min,zero=(-d.min/span)*100;
 return `<div class="ghc3-bars" style="--rows:${doc.series.length}">${doc.series.map(x=>{const pos=(Math.min(0,x.value)-d.min)/span*100,width=Math.abs(x.value)/span*100;return `<div class="ghc3-bar" data-value="${x.value}"><div class="ghc3-bar-label"><span title="${esc(x.label)}">${esc(x.label)}</span><b dir="rtl" title="${esc(doc.chartUnit?int(x.value):M.money(x.value))}"><bdi dir="ltr">${esc(doc.chartUnit?int(x.value):amount(x.value).value)}</bdi>${doc.chartUnit?'':' '+esc(amount(x.value).unit)}</b></div><div class="ghc3-track"><i class="ghc3-zero" style="left:${zero}%"></i><i class="ghc3-fill" style="left:${pos}%;width:${width}%;background:${x.color}"></i></div></div>`;}).join('')}</div><div class="ghc3-chart-axis"><span>القيم من سجل المؤتمر</span><span>${esc(doc.chartUnit||'USD · دولار أمريكي')}</span></div>`;
}
class Board{
 constructor(element){this.element=element;this.images=new Map();this.disposed=false;}
 update(snapshot,scene){this.doc=documentFor(snapshot,scene);const d=this.doc;
  const template=String(scene.templateId||'statement').replace(/[^a-z0-9_-]/gi,'').slice(0,48)||'statement',kind=String(scene.kind||'statement').replace(/[^a-z0-9_-]/gi,'').slice(0,48)||'statement',logo=safeLogo(d.logo);this.element.innerHTML=`<article class="ghc3-board ghc3-board-${kind} ghc3-template-${template}${d.series.length>4?' ghc3-board-dense':''}" data-template="${esc(template)}"><div class="ghc3-story">${logo?`<img class="ghc3-board-logo" src="${esc(logo)}" alt="شعار الشركة">`:''}<span class="ghc3-eyebrow"><i></i>${esc(d.eyebrow)}<em>${esc(d.year)}</em></span><div class="ghc3-hero"><small>${esc(d.heroLabel||'')}</small><h1 class="${d.numeric?'ghc3-number':''}" ${d.numeric?'dir="ltr"':''} title="${esc(d.exact||d.title)}">${esc(d.title).replace(/\n/g,'<br>')}</h1><p>${esc(d.unit)}</p></div><div class="ghc3-stats">${d.stats.map(m=>`<div><b dir="auto">${esc(m.value)}</b><span>${esc(m.label)}</span></div>`).join('')}</div></div><section class="ghc3-chart" aria-label="${esc(d.chartTitle)}"><header><h2>${esc(d.chartTitle)}</h2><span aria-hidden="true">↗</span></header>${graphHTML(d)}</section><p class="ghc3-board-note">${esc(d.note)}</p></article>`;
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
  stats.forEach((s,i)=>{const x=2265-i*gap;this.text(ctx,s.value,x,792,gap-22,48,COLORS.ink,500);this.lines(ctx,s.label,x,856,gap-22,31,COLORS.muted,400,2);});
  if(d.list){const gap=Math.min(194,615/Math.max(1,d.list.length));d.list.forEach((s,i)=>{const y=340+i*gap;panel(132,y-34,1225,gap-18,'#f5f8fc');this.text(ctx,String(i+1).padStart(2,'0'),178,y+25,65,28,COLORS.blue,500,'left');this.text(ctx,s.label,1295,y+18,1020,38,COLORS.muted);this.lines(ctx,s.value,1295,y+78,1030,d.list.length>3?42:58,COLORS.ink,500,2);});}
  else if(d.series.length){const scale=domain(d.series),span=scale.max-scale.min,left=142,right=1348,bw=right-left,zero=left-scale.min/span*bw,gap=Math.min(195,618/d.series.length),dense=d.series.length>4;
   d.series.forEach((s,i)=>{const y=350+i*gap;this.text(ctx,s.label,right,y,755,dense?34:43,COLORS.muted);this.text(ctx,d.chartUnit?int(s.value):amount(s.value).value+' '+amount(s.value).unit,left,y,415,dense?34:40,COLORS.ink,500,'left');ctx.fillStyle='#eaf0f7';ctx.fillRect(left,y+25,bw,dense?20:30);ctx.fillStyle=s.color;ctx.fillRect(left+(Math.min(0,s.value)-scale.min)/span*bw,y+25,Math.abs(s.value)/span*bw,dense?20:30);ctx.fillStyle='#718198';ctx.fillRect(zero,y+20,2,dense?30:40);});
  }else{this.text(ctx,'بانتظار البيانات المعتمدة',1345,495,1190,64,COLORS.ink,500);this.lines(ctx,d.empty||'',1345,584,1190,40,COLORS.muted,400,3);}
  this.text(ctx,d.note,2310,1030,2220,32,COLORS.muted);ctx.restore();
 }
 dispose(){this.disposed=true;for(const img of this.images.values())img.onload=null;this.images.clear();this.element.replaceChildren();}
}
globalThis.GH_CONF_BOARD=Object.freeze({Board,documentFor,amount,domain,COLORS});
})();
