/* Presentation adapters only. Never read or mutate the financial state. */
(()=>{'use strict';
let paperObserver=null;
const paperRoots='.financial-paper,.invoice-paper,.authority-paper,.authorization-paper,.approval-log-paper';
function textNode(tag,text){const el=document.createElement(tag);el.textContent=text||'—';return el;}
function prepare(root){
  paperObserver?.disconnect();paperObserver=null;
  root.querySelectorAll('.realism-budget-table').forEach(table=>{
    const head=table.querySelector('.budget-head');if(!head)return;
    const labels=['الشركة','الميزانية','الفعلي','المتوقع','الانحراف'];
    table.setAttribute('role','table');table.setAttribute('aria-label','الميزانية والنتائج والتوقعات');table.prepend(head);
    [...head.children].forEach((cell,i)=>{cell.textContent=labels[i];cell.setAttribute('role','columnheader');});
    [...table.children].forEach(row=>{row.setAttribute('role','row');if(row===head)return;[...row.children].forEach((cell,i)=>{cell.setAttribute('role',i?'cell':'rowheader');if(i){cell.dataset.label=labels[i];cell.setAttribute('aria-label',labels[i]+' '+cell.textContent);}});});
    const title=table.previousElementSibling;if(title?.tagName==='H3')title.textContent='الميزانية والنتائج والتوقعات';
  });
  const papers=[];
  root.querySelectorAll('.cheque-instrument').forEach((paper,index)=>{
    if(paper.closest('.ui-paper-sheet'))return;
    const viewport=document.createElement('div'),sheet=document.createElement('div'),toolbar=document.createElement('div'),zoom=textNode('button','تكبير الشيك');
    viewport.className='ui-paper-viewport';viewport.id='chequePreview'+index;sheet.className='ui-paper-sheet';toolbar.className='ui-paper-toolbar';zoom.type='button';zoom.setAttribute('aria-controls',viewport.id);zoom.setAttribute('aria-pressed','false');
    paper.before(viewport);viewport.append(sheet);sheet.append(paper);
    const summary=document.createElement('div');summary.className='ui-cheque-summary';
    summary.append(textNode('strong',paper.querySelector('.cheque-numeric-amount')?.textContent),textNode('span',paper.querySelector('.cheque-order-row strong')?.textContent),textNode('small',paper.querySelector('.cheque-number b')?.textContent));
    const hint=textNode('small','معاينة الشيك كاملة');toolbar.append(hint,zoom);viewport.after(toolbar,summary);
    const details=document.createElement('details'),list=document.createElement('dl');details.className='ui-document-fields';details.append(textNode('summary','قراءة جميع حقول الشيك'),list);summary.after(details);
    const fields=[['المصرف المسحوب عليه',paper.querySelector('.cheque-bank-brand b')?.textContent],['تاريخ الإصدار',paper.querySelector('.cheque-number span:last-child')?.textContent],['المبلغ كتابة',paper.querySelector('.cheque-amount-words b')?.textContent],...[...paper.querySelectorAll('.cheque-particulars>div,.cheque-memo-block,.cheque-signature')].map(row=>[row.querySelector('span')?.textContent,row.querySelector('b')?.textContent])];
    fields.forEach(([label,value])=>{const row=document.createElement('div');row.append(textNode('dt',label),textNode('dd',value));list.append(row);});
    const fit=()=>{if(!viewport.isConnected||!viewport.clientWidth)return;const zoomed=viewport.classList.contains('is-zoomed'),scale=Math.min(1,viewport.clientWidth/760);sheet.style.setProperty('--paper-scale',scale);viewport.style.height=(zoomed?Math.min(300,sheet.offsetHeight):Math.ceil(sheet.offsetHeight*scale))+'px';};
    zoom.onclick=()=>{const zoomed=viewport.classList.toggle('is-zoomed');zoom.setAttribute('aria-pressed',String(zoomed));zoom.textContent=zoomed?'عرض الشيك كاملًا':'تكبير الشيك';hint.textContent=zoomed?'اسحب لقراءة أجزاء الشيك':'معاينة الشيك كاملة';fit();viewport.scrollLeft=0;viewport.scrollTop=0;};
    papers.push({viewport,sheet,fit});
  });
  if(papers.length){const fit=()=>papers.forEach(p=>p.fit());paperObserver=new ResizeObserver(fit);papers.forEach(p=>{paperObserver.observe(p.viewport);paperObserver.observe(p.sheet);});requestAnimationFrame(fit);}
  root.querySelectorAll(paperRoots).forEach(p=>p.setAttribute('aria-label',p.classList.contains('cheque-instrument')?'صورة الشيك':'مستند مالي'));
}
globalThis.GH_FINANCE_PRESENTATION=Object.freeze({prepare});
})();
