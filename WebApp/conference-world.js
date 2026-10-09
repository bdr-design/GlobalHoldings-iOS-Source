/* Static photorealistic auditorium backdrop; live chapter content remains HTML. */
(()=>{'use strict';
const ANGLES=Object.freeze(['front','wide','stage']);
class Auditorium{
 constructor(viewport){this.viewport=viewport;this.disposed=false;this.angle='front';this.art=document.createElement('div');this.art.className='ghc3-stage-art';this.art.setAttribute('aria-hidden','true');const illustration=document.createElement('div');illustration.className='ghc3-auditorium-art';this.art.append(illustration);this.mountSideSignage();
 // The source auditorium already contains the presenter behind the lectern. Keep an invisible position marker
 // for the fixed-stage layout checks, but do not cut the presenter into a second image layer: that caused ghosting.
 this.presenter=document.createElement('span');this.presenter.className='ghc3-static-presenter';this.presenter.setAttribute('aria-hidden','true');this.presenterArtwork=document.createElementNS('http://www.w3.org/2000/svg','svg');this.presenterArtwork.classList.add('ghc3-presenter-overprint');this.presenterArtwork.setAttribute('viewBox','0 0 1614 745');this.presenterArtwork.setAttribute('preserveAspectRatio','none');this.presenterArtwork.setAttribute('aria-hidden','true');
 this.viewport.prepend(this.art);this.viewport.append(this.presenterArtwork,this.presenter);this.setAngle('front');}
 mountSideSignage(){
  this.signage=document.createElement('div');this.signage.className='ghc3-side-signage';this.signage.setAttribute('aria-hidden','true');this.art.append(this.signage);
  const make=side=>{const panel=document.createElement('div');panel.className=`ghc3-signage-panel ghc3-signage-panel-${side}`;panel.dataset.side=side;panel.setAttribute('role','img');panel.innerHTML='<span class="ghc3-signage-logo"><img alt="" hidden><b aria-hidden="true" hidden>GH</b></span>';this.signage.append(panel);return panel;};
  this.signagePanels=[make('left'),make('right')];
  const root=this.viewport.closest('.ghc3'),documentNode=root?.querySelector('.ghc3-document'),titleNode=root?.querySelector('.ghc3-current-title');
  this.brandObserver=new MutationObserver(()=>this.updateSideSignage());
  if(documentNode)this.brandObserver.observe(documentNode,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
  if(titleNode)this.brandObserver.observe(titleNode,{childList:true,characterData:true,subtree:true});
  this.updateSideSignage();
 }
 updateSideSignage(){
  if(this.disposed||!this.signagePanels?.length)return;
  const root=this.viewport.closest('.ghc3'),speaker=root?.querySelector('.ghc3-speaker span')?.textContent?.trim()||'',chapter=root?.querySelector('.ghc3-current-title')?.textContent?.trim()||'',companyName=!speaker||speaker==='قيادة المجموعة'?'المجموعة':speaker||chapter||'الشركة',logo=root?.querySelector('img.ghc3-board-logo')?.getAttribute('data-mark-src')||'';
  for(const panel of this.signagePanels){const image=panel.querySelector('img'),fallback=panel.querySelector('b');panel.setAttribute('aria-label',`شعار ${companyName}`);if(logo){if(image.getAttribute('src')!==logo)image.setAttribute('src',logo);image.alt=`شعار ${companyName}`;image.hidden=false;fallback.hidden=true;image.onerror=()=>{image.hidden=true;fallback.hidden=false;};}else{image.removeAttribute('src');image.hidden=true;fallback.hidden=false;}fallback.textContent='GH';}
 }
 setAngle(value){const angle=ANGLES.includes(value)?value:'front';this.angle=angle;this.viewport.closest('.ghc3')?.setAttribute('data-angle',angle);this.art.dataset.artAngle=angle;this.viewport.dataset.angle=angle;return angle;}
 dispose(){if(this.disposed)return;this.disposed=true;this.brandObserver?.disconnect();this.art.remove();this.presenterArtwork.remove();this.presenter.remove();}
}
globalThis.GH_CONF_WORLD=Object.freeze({Auditorium,ANGLES});
})();
