(()=>{'use strict';
const VERSION='1.0.0',MAX_STROKES=64,MAX_POINTS=8192,MAX_BYTES=32768;
const clone=value=>value===undefined?undefined:(globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value)));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const round=value=>Math.round(value*10000)/10000;
function pointOf(value){
  const x=Number(Array.isArray(value)?value[0]:value?.x),y=Number(Array.isArray(value)?value[1]:value?.y),pressure=Number(Array.isArray(value)?value[2]:value?.pressure);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)throw new Error('signature-point-out-of-range');
  const point={x:round(x),y:round(y)};if(Number.isFinite(pressure))point.pressure=Math.round(Math.max(0,Math.min(1,pressure))*1000)/1000;return point;
}
function normalize(input){
  if(!Array.isArray(input)||input.length>MAX_STROKES)throw new Error('signature-strokes-invalid');
  let count=0;const strokes=input.map(stroke=>{if(!Array.isArray(stroke)||stroke.length<2||stroke.length>2048)throw new Error('signature-stroke-invalid');return stroke.map(value=>{count++;if(count>MAX_POINTS)throw new Error('signature-points-limit');return pointOf(value);});});
  const json=JSON.stringify(strokes);if(new TextEncoder().encode(json).byteLength>MAX_BYTES)throw new Error('signature-data-too-large');return strokes;
}
function metrics(input){
  const strokes=normalize(input),all=strokes.flat();if(!all.length)return {strokes:0,points:0,length:0,width:0,height:0,valid:false};
  let length=0,minX=1,maxX=0,minY=1,maxY=0;for(const stroke of strokes){for(let index=0;index<stroke.length;index++){const point=stroke[index];minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);if(index){const prior=stroke[index-1];length+=Math.hypot(point.x-prior.x,point.y-prior.y);}}}
  const width=maxX-minX,height=maxY-minY,valid=all.length>=3&&length>=.075&&Math.max(width,height)>=.055;
  return {strokes:strokes.length,points:all.length,length:round(length),width:round(width),height:round(height),valid};
}
function validate(input){try{const result=metrics(input);return result.valid?{ok:true,...result}:{ok:false,reason:'signature-too-short',...result};}catch(error){return {ok:false,reason:String(error?.message||error),strokes:0,points:0,length:0,width:0,height:0,valid:false};}}
function safeInk(value){return /^#[0-9a-f]{6}$/i.test(String(value||''))?String(value).toLowerCase():'#123248';}
function svgMarkup(input,{width=640,height=220,ink='#123248',className='authorization-signature'}={}){
  const strokes=normalize(input),w=Math.max(1,Math.min(4096,Math.floor(Number(width)||640))),h=Math.max(1,Math.min(2048,Math.floor(Number(height)||220))),color=safeInk(ink),paths=strokes.map(stroke=>{const points=stroke.map(point=>`${(point.x*w).toFixed(2)},${(point.y*h).toFixed(2)}`);return `<polyline points="${points.join(' ')}"/>`;}).join('');
  return `<svg class="${String(className).replace(/[^a-zA-Z0-9 _-]/g,'')}" viewBox="0 0 ${w} ${h}" role="img" aria-label="التوقيع المرئي المعتمد" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="${color}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
}
function render(canvas,input,{ink='#123248'}={}){
  if(!canvas?.getContext)throw new TypeError('signature-canvas-required');const strokes=normalize(input),rect=canvas.getBoundingClientRect?.()||{width:canvas.width||640,height:canvas.height||220},width=Math.max(1,rect.width||640),height=Math.max(1,rect.height||220),ratio=Math.max(1,Math.min(3,Number(globalThis.devicePixelRatio)||1));
  if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);}const context=canvas.getContext('2d');context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,width,height);context.strokeStyle=safeInk(ink);context.lineCap='round';context.lineJoin='round';context.lineWidth=2.4;
  for(const stroke of strokes){context.beginPath();stroke.forEach((point,index)=>{const x=point.x*width,y=point.y*height;if(index)context.lineTo(x,y);else context.moveTo(x,y);});context.stroke();}return {width,height,ratio};
}
function mount(container,options={}){
  if(typeof document==='undefined'||!container?.append)throw new TypeError('signature-container-required');let strokes=[],active=null,destroyed=false,disabled=Boolean(options.disabled);const root=document.createElement('section');root.className='authorization-pad';root.dir='rtl';
  const header=document.createElement('header'),title=document.createElement('strong'),status=document.createElement('span');title.textContent=options.title||'التوقيع المرئي المعتمد';status.setAttribute('role','status');header.append(title,status);
  const surface=document.createElement('div'),canvas=document.createElement('canvas');surface.className='authorization-pad-surface';canvas.className='authorization-pad-canvas';canvas.setAttribute('aria-label','مساحة رسم التوقيع');canvas.setAttribute('role','img');canvas.style.touchAction='none';surface.append(canvas);
  const footer=document.createElement('footer'),hint=document.createElement('small'),undo=document.createElement('button'),clear=document.createElement('button');hint.textContent='وقّع داخل المساحة. يُحفظ مسار الرسم المشفّر بالبصمة، لا صورة قابلة للتنفيذ.';undo.type=clear.type='button';undo.textContent='تراجع';clear.textContent='مسح';footer.append(hint,undo,clear);root.append(header,surface,footer);container.append(root);
  const announce=()=>{const check=validate(strokes);status.textContent=check.ok?'التوقيع جاهز':strokes.length?'أكمل التوقيع بخط أوضح':'بانتظار التوقيع';undo.disabled=disabled||!strokes.length;clear.disabled=disabled||!strokes.length;options.onChange?.({strokes:clone(strokes),validation:check});return check;};
  const draw=()=>{if(!destroyed)render(canvas,strokes,{ink:options.ink});};const resize=()=>{draw();};const observer=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;observer?.observe(surface);
  const coordinate=event=>{const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)/Math.max(1,rect.width),y=(event.clientY-rect.top)/Math.max(1,rect.height);return pointOf({x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y)),pressure:finite(event.pressure)?event.pressure:undefined});};
  // A pointer-down is only a transient point.  Do not publish it into the
  // normalized stroke collection until movement supplies the second point;
  // render/validation intentionally reject one-point strokes.
  const down=event=>{if(disabled||destroyed||event.isPrimary===false||strokes.length>=MAX_STROKES)return;event.preventDefault();canvas.setPointerCapture?.(event.pointerId);active=[coordinate(event)];};
  const move=event=>{if(!active||disabled||destroyed)return;event.preventDefault();const point=coordinate(event),prior=active.at(-1);if(Math.hypot(point.x-prior.x,point.y-prior.y)<.0015)return;if(strokes.reduce((sum,row)=>sum+row.length,0)+(strokes.includes(active)?0:active.length)>=MAX_POINTS){up(event);return;}active.push(point);if(active.length===2)strokes.push(active);draw();};
  const up=event=>{if(!active)return;event.preventDefault?.();active=null;canvas.releasePointerCapture?.(event.pointerId);announce();draw();};
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('lostpointercapture',up);
  undo.onclick=()=>{if(disabled)return;strokes.pop();announce();draw();};clear.onclick=()=>{if(disabled)return;strokes=[];active=null;announce();draw();};
  const api={VERSION,element:root,canvas,clear:()=>{strokes=[];active=null;announce();draw();},undo:()=>{strokes.pop();announce();draw();},load:value=>{strokes=normalize(value);active=null;announce();draw();return api;},export:()=>{const check=validate(strokes);if(!check.ok)throw new Error(check.reason);return clone(normalize(strokes));},getStrokes:()=>clone(strokes),validation:()=>validate(strokes),setDisabled:value=>{disabled=Boolean(value);canvas.setAttribute('aria-disabled',String(disabled));announce();},destroy:()=>{if(destroyed)return;destroyed=true;observer?.disconnect();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);canvas.removeEventListener('lostpointercapture',up);root.remove();}};
  announce();globalThis.requestAnimationFrame?.(draw);return api;
}
const API=Object.freeze({VERSION,MAX_STROKES,MAX_POINTS,MAX_BYTES,normalize,metrics,validate,safeInk,svgMarkup,render,mount});globalThis.GH_SIGNATURE_PAD=API;if(globalThis.window&&window!==globalThis)globalThis.window.GH_SIGNATURE_PAD=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
