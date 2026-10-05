/* Presentation adapters only. Never read or mutate the financial state. */
(()=>{'use strict';
// Build 358: the cheque scales its own content to the drawer width (container units), so it needs no zoom viewport.
const paperRoots='.bank-doc,.financial-paper,.invoice-paper,.authority-paper,.authorization-paper,.approval-log-paper';
function prepare(root){
  root.querySelectorAll('.realism-budget-table').forEach(table=>{
    const head=table.querySelector('.budget-head');if(!head)return;
    const labels=['الشركة','الميزانية','الفعلي','المتوقع','الانحراف'];
    table.setAttribute('role','table');table.setAttribute('aria-label','الميزانية والنتائج والتوقعات');table.prepend(head);
    [...head.children].forEach((cell,i)=>{cell.textContent=labels[i];cell.setAttribute('role','columnheader');});
    [...table.children].forEach(row=>{row.setAttribute('role','row');if(row===head)return;[...row.children].forEach((cell,i)=>{cell.setAttribute('role',i?'cell':'rowheader');if(i){cell.dataset.label=labels[i];cell.setAttribute('aria-label',labels[i]+' '+cell.textContent);}});});
    const title=table.previousElementSibling;if(title?.tagName==='H3')title.textContent='الميزانية والنتائج والتوقعات';
  });
  // A cheque in a phone drawer is a true-proportion image; a tap shows it across the whole screen.
  root.querySelectorAll('.bank-doc.cheque-instrument').forEach(cheque=>{
    if(cheque.dataset.viewer)return;cheque.dataset.viewer='1';cheque.setAttribute('role','button');cheque.tabIndex=0;
    const hint=document.createElement('small');hint.className='cheque-hint';hint.textContent='اضغط على الشيك لعرضه بالحجم الكامل';cheque.closest('.bank-doc-card')?.after(hint);
    const open=()=>{if(document.querySelector('.cheque-viewer'))return;const viewer=document.createElement('div'),card=document.createElement('div'),close=document.createElement('button');viewer.className='cheque-viewer';viewer.setAttribute('role','dialog');viewer.setAttribute('aria-label','الشيك بالحجم الكامل');card.className='bank-doc-card';const copy=cheque.cloneNode(true);copy.removeAttribute('role');copy.removeAttribute('tabindex');card.append(copy);close.type='button';close.className='cheque-viewer-close';close.setAttribute('aria-label','إغلاق');close.textContent='✕';viewer.append(card,close);const dismiss=()=>{viewer.remove();document.removeEventListener('keydown',onKey);cheque.focus?.();},onKey=event=>{if(event.key==='Escape')dismiss();};viewer.addEventListener('click',dismiss);document.addEventListener('keydown',onKey);document.body.append(viewer);close.focus();};
    cheque.addEventListener('click',open);cheque.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});
  });
  root.querySelectorAll(paperRoots).forEach(p=>p.setAttribute('aria-label',p.classList.contains('cheque-instrument')?'صورة الشيك':'مستند مالي'));
}
globalThis.GH_FINANCE_PRESENTATION=Object.freeze({prepare});
})();
