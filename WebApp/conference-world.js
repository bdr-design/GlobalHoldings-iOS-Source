/* Static photorealistic auditorium backdrop; live chapter content remains HTML. */
(()=>{'use strict';
const ANGLES=Object.freeze(['front','wide','stage']);
class Auditorium{
 constructor(viewport){this.viewport=viewport;this.disposed=false;this.angle='front';this.art=document.createElement('div');this.art.className='ghc3-stage-art';this.art.setAttribute('aria-hidden','true');const illustration=document.createElement('div');illustration.className='ghc3-auditorium-art';this.art.append(illustration);this.presenter=document.createElement('span');this.presenter.className='ghc3-static-presenter';this.presenter.setAttribute('aria-hidden','true');this.presenterArtwork=document.createElementNS('http://www.w3.org/2000/svg','svg');this.presenterArtwork.classList.add('ghc3-presenter-overprint');this.presenterArtwork.setAttribute('viewBox','0 0 1614 745');this.presenterArtwork.setAttribute('preserveAspectRatio','none');this.presenterArtwork.setAttribute('aria-hidden','true');this.presenterArtwork.innerHTML='<defs><clipPath id="ghc3-presenter-mask" clipPathUnits="userSpaceOnUse"><path d="M1246 434 C1252 430 1262 433 1265 443 L1264 453 1273 458 1279 473 1274 478 1267 468 1265 484 1240 484 1238 468 1230 477 1225 474 1234 459 1245 453 1244 446Z"/><path d="M1221 470 1302 470 1297 481 1291 484 1291 554 1301 559 1301 566 1218 566 1218 559 1227 554 1227 484 1223 481Z"/></clipPath></defs><image href="assets/conference/auditorium-gold.webp" x="0" y="0" width="1614" height="745" clip-path="url(#ghc3-presenter-mask)"/>';
 this.viewport.prepend(this.art);this.viewport.append(this.presenterArtwork,this.presenter);this.setAngle('front');}
 setAngle(value){const angle=ANGLES.includes(value)?value:'front';this.angle=angle;this.viewport.closest('.ghc3')?.setAttribute('data-angle',angle);this.art.dataset.artAngle=angle;this.viewport.dataset.angle=angle;return angle;}
 dispose(){if(this.disposed)return;this.disposed=true;this.art.remove();this.presenterArtwork.remove();this.presenter.remove();}
}
globalThis.GH_CONF_WORLD=Object.freeze({Auditorium,ANGLES});
})();
