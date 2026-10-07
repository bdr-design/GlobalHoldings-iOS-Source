'use strict';

((root,factory)=>{
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){
    root.GH_MAP_VEHICLE_CANVAS=api;
    if(root.window&&root.window!==root)root.window.GH_MAP_VEHICLE_CANVAS=api;
  }
})(typeof globalThis!=='undefined'?globalThis:this,root=>{
  const VERSION='GH-MAP-VEHICLE-CANVAS-359.0.0';
  const MAX_VEHICLES=300;
  const ACTIVE_CONTAINERS=new WeakMap();
  const MAP_EVENTS=Object.freeze(['move','zoom','resize','viewreset']);
  const TYPE_COLORS=Object.freeze({
    air:'#58b8ff',aircraft:'#58b8ff',plane:'#58b8ff',
    sea:'#3ad0c3',ship:'#3ad0c3',vessel:'#3ad0c3',
    road:'#f6b94b',truck:'#f6b94b',car:'#f6b94b',mobility:'#f6b94b',
    rail:'#bd8cff',train:'#bd8cff',asset:'#d8e5ee'
  });

  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,finite(value,min)));
  const compareText=(left,right)=>left<right?-1:left>right?1:0;
  const positive=(...values)=>{for(const value of values){const number=Number(value);if(Number.isFinite(number)&&number>0)return number;}return 1;};
  const typeOf=value=>String(value||'asset').trim().toLowerCase()||'asset';
  const idOf=value=>{
    const id=String(value??'').trim();
    if(!id)throw new TypeError('map-vehicle-canvas-id-required');
    return id;
  };
  function latLngOf(value,fallback=null){
    let lat,lng;
    if(Array.isArray(value)){lat=Number(value[0]);lng=Number(value[1]);}
    else if(value&&typeof value==='object'){
      lat=Number(value.lat??value.latitude);
      lng=Number(value.lng??value.lon??value.longitude);
    }
    if(Number.isFinite(lat)&&Number.isFinite(lng)){
      const wrapped=((lng+180)%360+360)%360-180;
      return {lat:clamp(lat,-90,90),lng:wrapped===-180&&lng>0?180:wrapped};
    }
    if(fallback)return {lat:fallback.lat,lng:fallback.lng};
    throw new TypeError('map-vehicle-canvas-latlng-invalid');
  }
  function latLngFromDescriptor(value,fallback=null){
    if(value&&typeof value==='object'){
      if(value.latLng!=null)return latLngOf(value.latLng,fallback);
      if(value.latlng!=null)return latLngOf(value.latlng,fallback);
      if(value.coords!=null)return latLngOf(value.coords,fallback);
      if(value.position!=null)return latLngOf(value.position,fallback);
      if(value.lat!=null||value.latitude!=null)return latLngOf(value,fallback);
    }
    return fallback?{lat:fallback.lat,lng:fallback.lng}:latLngOf(value);
  }
  const headingOf=(value,fallback=0)=>{
    const heading=finite(value,fallback)%360;
    return heading<0?heading+360:heading;
  };
  const colorOf=(value,type,fallback)=>{
    const color=String(value||'').trim();
    return color||fallback||TYPE_COLORS[type]||TYPE_COLORS.asset;
  };
  const safeCall=(fn,...args)=>{try{return fn?.(...args);}catch{return undefined;}};
  const now=()=>typeof root?.performance?.now==='function'?root.performance.now():Date.now();

  function create(options={}){
    const map=options.map;
    if(!map||typeof map.latLngToContainerPoint!=='function')throw new TypeError('map-vehicle-canvas-map-required');
    const documentRef=options.document||root?.document;
    if(!documentRef||typeof documentRef.createElement!=='function')throw new TypeError('map-vehicle-canvas-document-required');
    const mapContainer=typeof map.getContainer==='function'?map.getContainer():null;
    const container=options.container||mapContainer;
    if(!container||typeof container.appendChild!=='function')throw new TypeError('map-vehicle-canvas-container-required');
    if(ACTIVE_CONTAINERS.has(container))throw new Error('map-vehicle-canvas-container-in-use');

    const requestedLimit=Math.floor(finite(options.hardLimit,MAX_VEHICLES));
    const hardLimit=Math.max(0,Math.min(MAX_VEHICLES,requestedLimit));
    const dprCap=clamp(options.dprCap??2,1,3);
    const baseSize=clamp(options.size??22,8,64);
    const hitPadding=clamp(options.hitPadding??5,0,32);
    const onSelect=typeof options.onSelect==='function'?options.onSelect:null;
    const imageFactory=typeof options.imageFactory==='function'?options.imageFactory:(typeof root?.Image==='function'?spec=>{const image=new root.Image();image.decoding='async';image.src=spec.url;return image;}:null);
    const canvas=documentRef.createElement('canvas');
    const requestedClass=String(options.className||'gh-map-vehicle-canvas').trim();
    canvas.className=`${requestedClass} leaflet-zoom-animated`.trim();
    canvas.setAttribute?.('aria-hidden','true');
    canvas.setAttribute?.('role','presentation');
    if(canvas.style){
      // Anchored by left/top only. With inset:0 and a pixel width inside Leaflet's zero-size pane, an RTL page (the game is
      // Arabic) resolves the over-constrained box from the right edge and the canvas lay one map width off screen: every
      // vehicle was drawn and none was visible (owner screenshot, Build 358).
      canvas.style.position='absolute';canvas.style.left='0';canvas.style.top='0';canvas.style.right='auto';canvas.style.bottom='auto';canvas.style.width='100%';canvas.style.height='100%';
      canvas.style.pointerEvents='none';canvas.style.zIndex=String(Math.floor(finite(options.zIndex,450)));canvas.style.transformOrigin='0 0';
    }
    container.appendChild(canvas);
    const context=canvas.getContext?.('2d',{alpha:true,desynchronized:true})||canvas.getContext?.('2d');
    if(!context){canvas.remove?.();throw new Error('map-vehicle-canvas-context-unavailable');}
    const containerToken={};ACTIVE_CONTAINERS.set(container,containerToken);

    const slots=Array.from({length:hardLimit},(_,index)=>({
      index,id:'',lat:0,lng:0,type:'asset',heading:0,selected:false,opacity:1,size:baseSize,color:TYPE_COLORS.asset,customColor:false,
      sprite:null,spriteUrl:'',imageKey:null,zIndex:0,x:0,y:0,visible:false,active:false,everUsed:false,adapter:null
    }));
    const free=[];for(let index=hardLimit-1;index>=0;index--)free.push(index);
    const records=new Map(),drawOrder=[],imageCache=new Map();
    let destroyed=false,dirty=true,rafToken=0,width=0,height=0,dpr=1,resizeObserver=null,drawCenter=null,drawZoom=null;
    const canBindMap=typeof map.on==='function'&&typeof map.off==='function';
    const counters={adds:0,updates:0,removes:0,clears:0,reuses:0,rejected:0,frames:0,drawn:0,culled:0,hitTests:0,hits:0,misses:0,highWater:0,lastDrawMs:0};

    const requestFrame=typeof root?.requestAnimationFrame==='function'?root.requestAnimationFrame.bind(root):null;
    const cancelFrame=typeof root?.cancelAnimationFrame==='function'?root.cancelAnimationFrame.bind(root):null;
    function cancelPending(){if(!rafToken)return;if(cancelFrame)safeCall(cancelFrame,rafToken);rafToken=0;}
    function scheduleDraw(){
      if(destroyed)return false;dirty=true;
      if(requestFrame){if(!rafToken)rafToken=requestFrame(()=>{rafToken=0;draw();});}
      else draw();
      return true;
    }

    function dimensions(){
      const rect=safeCall(container.getBoundingClientRect?.bind(container))||{};
      const mapSize=safeCall(map.getSize?.bind(map))||{};
      return {
        width:Math.max(1,Math.round(positive(container.clientWidth,rect.width,mapSize.x))),
        height:Math.max(1,Math.round(positive(container.clientHeight,rect.height,mapSize.y)))
      };
    }
    function resize(){
      const size=dimensions(),deviceDpr=clamp(options.devicePixelRatio??root?.devicePixelRatio??1,1,dprCap),pixelWidth=Math.max(1,Math.round(size.width*deviceDpr)),pixelHeight=Math.max(1,Math.round(size.height*deviceDpr));
      width=size.width;height=size.height;dpr=deviceDpr;
      if(canvas.style){canvas.style.width=`${size.width}px`;canvas.style.height=`${size.height}px`;}
      if(canvas.width!==pixelWidth)canvas.width=pixelWidth;
      if(canvas.height!==pixelHeight)canvas.height=pixelHeight;
      return size;
    }
    function projectionOffset(){
      if(!mapContainer||mapContainer===container)return {x:0,y:0};
      const mapRect=safeCall(mapContainer.getBoundingClientRect?.bind(mapContainer)),containerRect=safeCall(container.getBoundingClientRect?.bind(container));
      return mapRect&&containerRect?{x:finite(mapRect.left)-finite(containerRect.left),y:finite(mapRect.top)-finite(containerRect.top)}:{x:0,y:0};
    }
    function project(slot,offset){
      const point=safeCall(map.latLngToContainerPoint.bind(map),[slot.lat,slot.lng]);
      const x=Number(point?.x??point?.[0]),y=Number(point?.y??point?.[1]);
      if(!Number.isFinite(x)||!Number.isFinite(y))return null;
      return {x:x+offset.x,y:y+offset.y};
    }
    function readyImage(image){return Boolean(image&&image.complete!==false&&(image.naturalWidth==null||image.naturalWidth>0));}
    function detachImage(entry){
      if(!entry?.image)return;
      if(entry.load)entry.image.removeEventListener?.('load',entry.load);
      if(entry.error)entry.image.removeEventListener?.('error',entry.error);
    }
    function imageKeyFor(slot){
      if(slot.sprite&&(typeof slot.sprite==='object'||typeof slot.sprite==='function'))return slot.sprite;
      return slot.spriteUrl?`url:${slot.type}\u0000${slot.spriteUrl}`:null;
    }
    function createImageEntry(slot,key){
      const direct=key===slot.sprite,spec=direct?null:Object.freeze({key,type:slot.type,url:slot.spriteUrl});
      const image=direct?slot.sprite:(imageFactory?safeCall(imageFactory,spec,slot.spriteUrl,slot.type)||null:null),entry={image,refs:0,load:null,error:null};
      if(image&&!readyImage(image)&&typeof image.addEventListener==='function'){
        const finish=()=>{detachImage(entry);entry.load=null;entry.error=null;scheduleDraw();};
        entry.load=finish;entry.error=finish;image.addEventListener('load',finish,{once:true});image.addEventListener('error',finish,{once:true});
      }
      return entry;
    }
    function releaseImage(slot){
      const key=slot.imageKey;if(key==null)return;const entry=imageCache.get(key);slot.imageKey=null;
      if(!entry)return;entry.refs=Math.max(0,entry.refs-1);if(entry.refs===0){detachImage(entry);imageCache.delete(key);}
    }
    function syncImage(slot){
      const next=imageKeyFor(slot);if(next===slot.imageKey)return;
      releaseImage(slot);if(next==null)return;
      let entry=imageCache.get(next);if(!entry){entry=createImageEntry(slot,next);imageCache.set(next,entry);}entry.refs++;slot.imageKey=next;
    }
    function cachedImage(slot){
      return slot.imageKey==null?null:(imageCache.get(slot.imageKey)?.image||null);
    }
    function pathFor(slot,radius){
      const type=slot.type;
      context.beginPath();
      if(type==='air'||type==='aircraft'||type==='plane'){
        context.moveTo(0,-radius);context.lineTo(radius*.42,radius*.58);context.lineTo(0,radius*.28);context.lineTo(-radius*.42,radius*.58);context.closePath();
      }else if(type==='sea'||type==='ship'||type==='vessel'){
        context.moveTo(0,-radius*.92);context.lineTo(radius*.72,radius*.38);context.lineTo(radius*.4,radius*.75);context.lineTo(-radius*.4,radius*.75);context.lineTo(-radius*.72,radius*.38);context.closePath();
      }else if(type==='road'||type==='truck'||type==='car'||type==='mobility'){
        context.moveTo(-radius*.48,-radius);context.lineTo(radius*.48,-radius);context.lineTo(radius*.62,radius*.76);context.lineTo(-radius*.62,radius*.76);context.closePath();
      }else if(type==='rail'||type==='train'){
        context.moveTo(-radius*.56,-radius);context.lineTo(radius*.56,-radius);context.lineTo(radius*.56,radius*.7);context.lineTo(0,radius);context.lineTo(-radius*.56,radius*.7);context.closePath();
      }else context.arc(0,0,radius*.68,0,Math.PI*2);
    }
    function paint(slot){
      const size=slot.size,radius=size/2,image=cachedImage(slot);
      context.save();context.translate(slot.x,slot.y);context.rotate(slot.heading*Math.PI/180);context.globalAlpha=slot.opacity;
      let imageDrawn=false;if(readyImage(image))try{context.drawImage(image,-radius,-radius,size,size);imageDrawn=true;}catch{}
      if(!imageDrawn){
        pathFor(slot,radius);context.fillStyle=slot.color;context.fill();context.lineWidth=Math.max(1,Math.min(2,size*.08));context.strokeStyle='rgba(8,24,38,.82)';context.stroke();
      }
      if(slot.selected){
        context.beginPath();context.arc(0,0,radius+3,0,Math.PI*2);context.lineWidth=2;context.strokeStyle='#ffffff';context.stroke();
      }
      context.restore();
    }
    function orderedSlots(){
      const rows=[];for(const slot of records.values())rows.push(slot);
      rows.sort((a,b)=>Number(a.selected)-Number(b.selected)||a.zIndex-b.zIndex||compareText(a.id,b.id));
      return rows;
    }
    function draw(){
      if(destroyed)return metrics();
      cancelPending();const started=now();resize();dirty=false;drawOrder.length=0;if(canvas.style)canvas.style.transform='none';
      context.setTransform?.(1,0,0,1,0,0);context.clearRect(0,0,canvas.width,canvas.height);context.setTransform?.(dpr,0,0,dpr,0,0);
      const offset=projectionOffset(),rows=orderedSlots();let culled=0;
      for(const slot of rows){
        slot.visible=false;const point=project(slot,offset);if(!point||slot.opacity<=0){culled++;continue;}
        slot.x=point.x;slot.y=point.y;const margin=slot.size+hitPadding;
        if(slot.x < -margin||slot.y < -margin||slot.x > width+margin||slot.y > height+margin){culled++;continue;}
        slot.visible=true;drawOrder.push(slot.index);paint(slot);
      }
      const center=safeCall(map.getCenter?.bind(map));drawCenter=center&&Number.isFinite(Number(center.lat))&&Number.isFinite(Number(center.lng))?{lat:Number(center.lat),lng:Number(center.lng)}:null;
      const zoom=Number(safeCall(map.getZoom?.bind(map)));drawZoom=Number.isFinite(zoom)?zoom:null;
      counters.frames++;counters.drawn=drawOrder.length;counters.culled=culled;counters.lastDrawMs=Math.max(0,now()-started);
      return metrics();
    }

    function apply(slot,patch,initial=false){
      if(!patch||typeof patch!=='object')throw new TypeError('map-vehicle-canvas-descriptor-required');
      const point=latLngFromDescriptor(patch,initial?null:{lat:slot.lat,lng:slot.lng});
      slot.lat=point.lat;slot.lng=point.lng;
      const typeChanged=initial||Object.prototype.hasOwnProperty.call(patch,'type')||Object.prototype.hasOwnProperty.call(patch,'mode');
      if(typeChanged)slot.type=typeOf(patch.type??patch.mode??slot.type);
      if(initial||Object.prototype.hasOwnProperty.call(patch,'heading')||Object.prototype.hasOwnProperty.call(patch,'bearing'))slot.heading=headingOf(patch.heading??patch.bearing,slot.heading);
      if(initial||Object.prototype.hasOwnProperty.call(patch,'selected'))slot.selected=Boolean(patch.selected);
      if(initial||Object.prototype.hasOwnProperty.call(patch,'opacity'))slot.opacity=clamp(patch.opacity??1,0,1);
      if(initial||Object.prototype.hasOwnProperty.call(patch,'size'))slot.size=clamp(patch.size??baseSize,8,64);
      if(initial||Object.prototype.hasOwnProperty.call(patch,'color')){slot.customColor=typeof patch.color==='string'&&Boolean(patch.color.trim());slot.color=colorOf(patch.color,slot.type,null);}
      else if(typeChanged&&!slot.customColor)slot.color=colorOf(null,slot.type,null);
      if(initial||Object.prototype.hasOwnProperty.call(patch,'sprite')||Object.prototype.hasOwnProperty.call(patch,'image'))slot.sprite=patch.sprite??patch.image??null;
      if(initial||Object.prototype.hasOwnProperty.call(patch,'spriteUrl')||Object.prototype.hasOwnProperty.call(patch,'imageUrl')||Object.prototype.hasOwnProperty.call(patch,'src'))slot.spriteUrl=String(patch.spriteUrl??patch.imageUrl??patch.src??'');
      if(initial||Object.prototype.hasOwnProperty.call(patch,'zIndex')||Object.prototype.hasOwnProperty.call(patch,'priority'))slot.zIndex=finite(patch.zIndex??patch.priority,0);
      syncImage(slot);
    }
    function snapshot(slot){return Object.freeze({id:slot.id,lat:slot.lat,lng:slot.lng,type:slot.type,heading:slot.heading,selected:slot.selected,opacity:slot.opacity,size:slot.size});}
    function makeAdapter(id){
      const adapter={
        id,
        setLatLng(value){update(id,{latLng:value});return adapter;},
        getLatLng(){const slot=records.get(id);return slot?Object.freeze({lat:slot.lat,lng:slot.lng}):null;},
        setOpacity(value){update(id,{opacity:value});return adapter;},
        setHeading(value){update(id,{heading:value});return adapter;},
        setSelected(value){update(id,{selected:value});return adapter;},
        update(value){update(id,value);return adapter;},
        remove(){remove(id);return adapter;},
        getSnapshot(){const slot=records.get(id);return slot?snapshot(slot):null;}
      };
      return Object.freeze(adapter);
    }
    function add(idOrDescriptor,descriptor){
      if(destroyed)return null;
      const patch=descriptor===undefined&&idOrDescriptor&&typeof idOrDescriptor==='object'?idOrDescriptor:descriptor;
      const id=idOf(descriptor===undefined&&idOrDescriptor&&typeof idOrDescriptor==='object'?(idOrDescriptor.id??idOrDescriptor.key):idOrDescriptor);
      if(records.has(id)){update(id,patch);return records.get(id).adapter;}
      if(!free.length){counters.rejected++;return null;}
      const slot=slots[free.pop()];if(slot.everUsed)counters.reuses++;
      slot.active=true;slot.id=id;slot.heading=0;slot.selected=false;slot.opacity=1;slot.size=baseSize;slot.type='asset';slot.color=TYPE_COLORS.asset;slot.customColor=false;slot.sprite=null;slot.spriteUrl='';slot.imageKey=null;slot.zIndex=0;slot.visible=false;
      try{apply(slot,patch,true);}catch(error){slot.active=false;slot.id='';free.push(slot.index);throw error;}
      slot.everUsed=true;slot.adapter=makeAdapter(id);records.set(id,slot);counters.adds++;counters.highWater=Math.max(counters.highWater,records.size);scheduleDraw();return slot.adapter;
    }
    function update(idValue,patch){
      if(destroyed)return false;const id=idOf(idValue),slot=records.get(id);if(!slot)return false;
      apply(slot,patch,false);counters.updates++;scheduleDraw();return slot.adapter;
    }
    function release(slot){
      releaseImage(slot);slot.active=false;slot.visible=false;slot.id='';slot.adapter=null;slot.sprite=null;slot.spriteUrl='';free.push(slot.index);
    }
    function remove(idValue){
      if(destroyed)return false;const id=idOf(idValue),slot=records.get(id);if(!slot)return false;
      records.delete(id);release(slot);counters.removes++;scheduleDraw();return true;
    }
    function clear(){
      if(destroyed)return 0;const removed=records.size;if(!removed)return 0;
      for(const slot of records.values())release(slot);records.clear();drawOrder.length=0;counters.clears++;counters.removes+=removed;scheduleDraw();return removed;
    }
    function count(){return records.size;}
    function localPoint(xOrPoint,y){
      if(xOrPoint&&typeof xOrPoint==='object'){
        if(Number.isFinite(Number(xOrPoint.clientX))&&Number.isFinite(Number(xOrPoint.clientY))){const rect=canvas.getBoundingClientRect?.()||container.getBoundingClientRect?.()||{left:0,top:0};return {x:Number(xOrPoint.clientX)-finite(rect.left),y:Number(xOrPoint.clientY)-finite(rect.top)};}
        const point=xOrPoint.containerPoint||xOrPoint,offset=xOrPoint.containerPoint?projectionOffset():{x:0,y:0};
        return {x:Number(point.x??point[0])+offset.x,y:Number(point.y??point[1])+offset.y};
      }
      return {x:Number(xOrPoint),y:Number(y)};
    }
    function hitTest(xOrPoint,y,radius=0){
      if(destroyed)return null;if(dirty)draw();counters.hitTests++;
      const point=localPoint(xOrPoint,y);if(!Number.isFinite(point.x)||!Number.isFinite(point.y)){counters.misses++;return null;}
      const extra=Math.max(0,finite(radius,0));
      for(let cursor=drawOrder.length-1;cursor>=0;cursor--){const slot=slots[drawOrder[cursor]];if(!slot.active||!slot.visible)continue;const hitRadius=slot.size/2+hitPadding+extra,dx=point.x-slot.x,dy=point.y-slot.y;if(dx*dx+dy*dy<=hitRadius*hitRadius){counters.hits++;return snapshot(slot);}}
      counters.misses++;return null;
    }
    function metrics(){
      return Object.freeze({version:VERSION,hardLimit,active:records.size,free:free.length,slotObjects:slots.length,highWater:counters.highWater,adds:counters.adds,updates:counters.updates,removes:counters.removes,clears:counters.clears,slotReuses:counters.reuses,rejectedAtLimit:counters.rejected,frames:counters.frames,drawn:counters.drawn,culled:counters.culled,hitTests:counters.hitTests,hits:counters.hits,misses:counters.misses,width,height,dpr,imageCacheSize:imageCache.size,canvasCount:destroyed?0:1,pendingFrame:Boolean(rafToken),destroyed,lastDrawMs:counters.lastDrawMs});
    }
    function handleClick(event){
      if(destroyed||!onSelect)return;const source=event?.propagatedFrom||event?.sourceTarget;if(source&&source!==map)return;
      const hit=hitTest(event);if(!hit)return;const adapter=records.get(hit.id)?.adapter||null;safeCall(onSelect,hit,adapter,event);
    }
    const handleMapChange=()=>scheduleDraw();
    function handleZoomAnimation(event={}){
      if(destroyed)return;cancelPending();const targetZoom=Number(event.zoom),targetCenter=event.center;
      if(!canvas.style||drawZoom==null||!drawCenter||!Number.isFinite(targetZoom)||!targetCenter||typeof map.getZoomScale!=='function'||typeof map.project!=='function'){scheduleDraw();return;}
      const scale=Number(safeCall(map.getZoomScale.bind(map),targetZoom,drawZoom)),current=safeCall(map.project.bind(map),drawCenter,targetZoom),target=safeCall(map.project.bind(map),targetCenter,targetZoom),size=safeCall(map.getSize?.bind(map));
      if(!Number.isFinite(scale)||!Number.isFinite(Number(current?.x))||!Number.isFinite(Number(current?.y))||!Number.isFinite(Number(target?.x))||!Number.isFinite(Number(target?.y))||!Number.isFinite(Number(size?.x))||!Number.isFinite(Number(size?.y))){scheduleDraw();return;}
      const offset=projectionOffset(),x=Number(size.x)*.5*(1-scale)+Number(current.x)-Number(target.x)+offset.x*(1-scale),y=Number(size.y)*.5*(1-scale)+Number(current.y)-Number(target.y)+offset.y*(1-scale);
      canvas.style.transformOrigin='0 0';canvas.style.transform=`translate(${x}px,${y}px) scale(${scale})`;
    }
    const handleZoomEnd=()=>{if(canvas.style)canvas.style.transform='none';scheduleDraw();};
    if(canBindMap){for(const type of MAP_EVENTS)map.on(type,handleMapChange);map.on('zoomanim',handleZoomAnimation);map.on('zoomend',handleZoomEnd);map.on('click',handleClick);}
    else container.addEventListener?.('click',handleClick);
    if(typeof root?.ResizeObserver==='function'){
      resizeObserver=new root.ResizeObserver(()=>scheduleDraw());safeCall(resizeObserver.observe?.bind(resizeObserver),container);
    }
    function destroy(){
      if(destroyed)return false;destroyed=true;cancelPending();
      if(canBindMap){for(const type of MAP_EVENTS)map.off(type,handleMapChange);map.off('zoomanim',handleZoomAnimation);map.off('zoomend',handleZoomEnd);map.off('click',handleClick);}
      else container.removeEventListener?.('click',handleClick);
      resizeObserver?.disconnect?.();resizeObserver=null;
      for(const slot of records.values()){releaseImage(slot);slot.active=false;slot.visible=false;slot.adapter=null;}records.clear();
      for(const entry of imageCache.values())detachImage(entry);imageCache.clear();drawOrder.length=0;free.length=0;
      if(ACTIVE_CONTAINERS.get(container)===containerToken)ACTIVE_CONTAINERS.delete(container);
      canvas.remove?.();return true;
    }

    resize();
    return Object.freeze({VERSION,canvas,hardLimit,add,update,remove,clear,draw,count,destroy,hitTest,metrics});
  }

  return Object.freeze({VERSION,MAX_VEHICLES,create});
});
