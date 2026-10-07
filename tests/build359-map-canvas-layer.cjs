'use strict';

const assert=require('node:assert/strict');

class FakeContext{
  constructor(){this.operations=[];this.globalAlpha=1;this.fillStyle='';this.strokeStyle='';this.lineWidth=1;}
  op(name,...values){this.operations.push([name,...values]);}
  setTransform(...values){this.op('setTransform',...values);}
  clearRect(...values){this.op('clearRect',...values);}
  save(){this.op('save');}
  restore(){this.op('restore');}
  translate(...values){this.op('translate',...values);}
  rotate(...values){this.op('rotate',...values);}
  beginPath(){this.op('beginPath');}
  moveTo(...values){this.op('moveTo',...values);}
  lineTo(...values){this.op('lineTo',...values);}
  closePath(){this.op('closePath');}
  arc(...values){this.op('arc',...values);}
  fill(){this.op('fill',this.fillStyle,this.globalAlpha);}
  stroke(){this.op('stroke',this.strokeStyle,this.lineWidth,this.globalAlpha);}
  drawImage(image,...values){if(image?.invalid)throw new TypeError('invalid-image');this.op('drawImage',image.key||image.src||'image',...values);}
  reset(){this.operations=[];}
}

class FakeCanvas{
  constructor(owner){this.owner=owner;this.style={};this.attributes={};this.className='';this.width=0;this.height=0;this.parentNode=null;this.context=new FakeContext();}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getContext(type){assert.equal(type,'2d');return this.context;}
  getBoundingClientRect(){return this.parentNode?.getBoundingClientRect?.()||{left:0,top:0,width:0,height:0};}
  remove(){if(this.parentNode)this.parentNode.removeChild(this);}
}

class FakeContainer{
  constructor(width=400,height=200,left=0,top=0){this.clientWidth=width;this.clientHeight=height;this.left=left;this.top=top;this.children=[];this.listeners=new Map();}
  appendChild(child){this.children.push(child);child.parentNode=this;return child;}
  removeChild(child){const index=this.children.indexOf(child);if(index>=0)this.children.splice(index,1);child.parentNode=null;return child;}
  getBoundingClientRect(){return {left:this.left,top:this.top,width:this.clientWidth,height:this.clientHeight};}
  addEventListener(type,listener){const rows=this.listeners.get(type)||new Set();rows.add(listener);this.listeners.set(type,rows);}
  removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
  dispatch(type,event={}){for(const listener of [...(this.listeners.get(type)||[])])listener({type,...event});}
  listenerCount(){return [...this.listeners.values()].reduce((sum,rows)=>sum+rows.size,0);}
}

class FakeDocument{
  constructor(){this.created=[];}
  createElement(name){assert.equal(name,'canvas','the layer creates no per-asset DOM nodes');const canvas=new FakeCanvas(this);this.created.push(canvas);return canvas;}
}

class FakeMap{
  constructor(container){this.container=container;this.listeners=new Map();this.zoom=4;this.center={lat:0,lng:0};}
  getContainer(){return this.container;}
  getSize(){return {x:this.container.clientWidth,y:this.container.clientHeight};}
  getCenter(){return {...this.center};}
  getZoom(){return this.zoom;}
  getZoomScale(to,from){return 2**(Number(to)-Number(from));}
  project(value,zoom){const scale=2**Number(zoom);return {x:(Number(value.lng)+180)*scale,y:(90-Number(value.lat))*scale};}
  latLngToContainerPoint(value){const lat=Number(value[0]),lng=Number(value[1]);return {x:lng+180,y:90-lat};}
  on(type,listener){const rows=this.listeners.get(type)||new Set();rows.add(listener);this.listeners.set(type,rows);return this;}
  off(type,listener){this.listeners.get(type)?.delete(listener);return this;}
  emit(type,event={}){for(const listener of [...(this.listeners.get(type)||[])])listener({type,...event});}
  listenerCount(){return [...this.listeners.values()].reduce((sum,rows)=>sum+rows.size,0);}
}

class FakeResizeObserver{
  static instances=[];
  constructor(callback){this.callback=callback;this.target=null;this.disconnected=false;FakeResizeObserver.instances.push(this);}
  observe(target){this.target=target;}
  disconnect(){this.disconnected=true;this.target=null;}
}

function installEnvironment(){
  const previous={document:global.document,devicePixelRatio:global.devicePixelRatio,requestAnimationFrame:global.requestAnimationFrame,cancelAnimationFrame:global.cancelAnimationFrame,ResizeObserver:global.ResizeObserver};
  const document=new FakeDocument(),frames=new Map();let nextFrame=0;
  global.document=document;global.devicePixelRatio=3;
  global.requestAnimationFrame=callback=>{const id=++nextFrame;frames.set(id,callback);return id;};
  global.cancelAnimationFrame=id=>frames.delete(id);
  global.ResizeObserver=FakeResizeObserver;
  return {
    document,frames,
    flush(){const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(16);},
    restore(){for(const [key,value] of Object.entries(previous)){if(value===undefined)delete global[key];else global[key]=value;}FakeResizeObserver.instances=[];}
  };
}

function vehicle(id,index,extra={}){
  return Object.freeze({id,lat:40-(index%80),lng:-170+(index%340),type:['air','sea','road'][index%3],heading:(index*37)%360,size:18+(index%3),...extra});
}

function testSingleCanvasCapAndPool(core,environment){
  const container=new FakeContainer(400,200),map=new FakeMap(container),layer=core.create({map,dprCap:1.5});
  assert.equal(layer.hardLimit,300);assert.match(layer.canvas.className,/\bleaflet-zoom-animated\b/);assert.equal(container.children.length,1);assert.equal(environment.document.created.length,1,'exactly one canvas exists for the whole fleet');
  assert.throws(()=>core.create({map}),/container-in-use/,'a map container cannot accidentally receive a second fleet canvas');
  const first=vehicle('asset-000',0),before=JSON.stringify(first);let adapter=null;
  for(let index=0;index<305;index++){const result=layer.add(vehicle(`asset-${String(index).padStart(3,'0')}`,index));if(index===0)adapter=result;if(index<300)assert.ok(result);else assert.equal(result,null);}
  assert.equal(JSON.stringify(first),before,'adding a vehicle never mutates the caller snapshot');assert.equal(layer.count(),300);assert.equal(layer.metrics().rejectedAtLimit,5);assert.equal(environment.document.created.length,1,'300 assets do not create 300 DOM markers');
  environment.flush();assert.equal(layer.canvas.width,600);assert.equal(layer.canvas.height,300);assert.equal(layer.canvas.style.width,'400px');assert.equal(layer.canvas.style.height,'200px','a zero-sized Leaflet pane still receives viewport CSS dimensions');assert.equal(layer.metrics().dpr,1.5,'device DPR is capped');
  assert.deepEqual(adapter.getLatLng(),{lat:40,lng:-170});adapter.setOpacity(.4).setHeading(91).setLatLng([12,21]);assert.deepEqual(adapter.getLatLng(),{lat:12,lng:21});
  assert.equal(layer.remove('asset-100'),true);assert.equal(layer.add(vehicle('replacement',2))?.id,'replacement');assert.equal(layer.count(),300);assert.equal(layer.metrics().slotReuses,1,'a released fixed slot is reused');assert.equal(layer.metrics().slotObjects,300);
  layer.destroy();assert.equal(container.children.length,0);assert.equal(map.listenerCount(),0);assert.equal(container.listenerCount(),0);assert.equal(layer.metrics().canvasCount,0);
  const disabled=core.create({map,hardLimit:0});assert.equal(disabled.hardLimit,0);assert.equal(disabled.add(vehicle('disabled',0)),null);disabled.destroy();
}

function testHitTestingSelectionAndDeterminism(core,environment){
  const selected=[],mapContainer=new FakeContainer(400,200,50,30),container=new FakeContainer(400,200,70,50),map=new FakeMap(mapContainer),layer=core.create({map,container,hardLimit:8,dprCap:2,onSelect:(hit,adapter,event)=>selected.push({hit,adapter,event})});
  layer.add(vehicle('road-z',0,{lat:10,lng:10,type:'road',selected:true,zIndex:1}));
  layer.add(vehicle('air-a',1,{lat:20,lng:30,type:'air',heading:45,zIndex:4}));
  layer.add(vehicle('sea-m',2,{lat:-20,lng:-30,type:'sea',heading:180,zIndex:2}));
  layer.add(vehicle('road-under',3,{lat:10,lng:10,type:'road',selected:false,zIndex:99}));
  layer.draw();const context=layer.canvas.context;
  context.reset();layer.draw();const first=structuredClone(context.operations);
  layer.remove('air-a');layer.add(vehicle('air-a',1,{lat:20,lng:30,type:'air',heading:45,zIndex:4}));context.reset();layer.draw();assert.deepEqual(context.operations,first,'draw order is deterministic even when insertion and pool-slot order change');
  const air=layer.hitTest({x:190,y:50});assert.equal(air.id,'air-a');assert.equal(Object.isFrozen(air),true);
  assert.equal(layer.hitTest({x:399,y:199}),null);
  map.emit('click',{containerPoint:{x:190,y:80}});assert.equal(selected.length,1);assert.equal(selected[0].hit.id,'road-z');assert.equal(selected[0].adapter.id,'road-z');
  map.emit('click',{containerPoint:{x:190,y:80},sourceTarget:{kind:'polyline'}});assert.equal(selected.length,1,'clicks bubbling from interactive Leaflet paths do not select a vehicle behind them');
  map.emit('click',{containerPoint:{x:190,y:80},sourceTarget:map,propagatedFrom:{kind:'route'}});assert.equal(selected.length,1);
  map.emit('zoomanim',{zoom:5,center:{lat:0,lng:10}});assert.equal(layer.canvas.style.transform,'translate(-500px,-80px) scale(2)','animated zoom includes the custom-container projection offset');
  map.emit('zoomend');assert.equal(layer.canvas.style.transform,'none');environment.flush();
  const beforeFrames=layer.metrics().frames;map.emit('move');assert.equal(environment.frames.size,1,'map events are coalesced into one animation frame');map.emit('zoom');assert.equal(environment.frames.size,1);environment.flush();assert.equal(layer.metrics().frames,beforeFrames+1);
  const observer=FakeResizeObserver.instances.at(-1);assert.equal(observer.target,container);layer.destroy();assert.equal(observer.disconnected,true);assert.equal(environment.frames.size,0);assert.equal(map.listenerCount(),0);assert.equal(container.listenerCount(),0);assert.equal(container.children.length,0,'destroy removes the sole canvas');assert.equal(layer.destroy(),false,'destroy is idempotent');
}

function testSpriteFallback(core,environment){
  const fakeImage=key=>{const listeners=new Map(),image={key,complete:false,naturalWidth:0,listeners,addEventListener:(type,listener)=>listeners.set(type,listener),removeEventListener:(type,listener)=>{if(listeners.get(type)===listener)listeners.delete(type);}};return image;};
  const container=new FakeContainer(400,200),map=new FakeMap(container),images=[];
  let factoryCalls=0;const layer=core.create({map,hardLimit:2,imageFactory:spec=>{factoryCalls++;assert.equal(Object.isFrozen(spec),true);assert.equal(spec.type,'air');const image=fakeImage(spec.url);images.push(image);return image;}});
  layer.add({id:'image-plane',lat:0,lng:0,type:'air',spriteUrl:'plane.png'});layer.draw();assert.equal(factoryCalls,1);assert.equal(layer.canvas.context.operations.some(row=>row[0]==='drawImage'),false,'fallback vector is used before the sprite loads');
  layer.update('image-plane',{spriteUrl:'plane-v2.png'});assert.equal(layer.metrics().imageCacheSize,1,'changing a URL evicts the unreferenced image immediately');assert.equal(images[0].listeners.size,0,'eviction removes pending image listeners');
  const direct=fakeImage('direct-plane');layer.add({id:'direct-plane',lat:12,lng:12,type:'air',sprite:direct});layer.draw();assert.equal(layer.metrics().imageCacheSize,2);
  direct.complete=true;direct.naturalWidth=64;direct.listeners.get('load')?.();environment.flush();layer.canvas.context.reset();layer.draw();assert.equal(layer.canvas.context.operations.some(row=>row[0]==='drawImage'),true,'a direct sprite schedules redraw when it finishes loading');
  layer.update('direct-plane',{sprite:{invalid:true}});layer.canvas.context.reset();assert.doesNotThrow(()=>layer.draw());assert.equal(layer.canvas.context.operations.some(row=>row[0]==='fill'),true,'an invalid CanvasImageSource falls back without aborting the frame');
  layer.update('image-plane',{type:'sea',spriteUrl:'',color:null});assert.equal(layer.add({id:'image-plane',lat:0,lng:0})?.getSnapshot().type,'sea');assert.equal(layer.metrics().imageCacheSize,1);
  layer.remove('direct-plane');assert.equal(direct.listeners.size,0);assert.equal(layer.metrics().imageCacheSize,0);layer.clear();layer.destroy();assert.equal(images.every(image=>image.listeners.size===0),true,'image churn, clear and destroy leave no image listeners');
}

(async()=>{
  const environment=installEnvironment();
  try{
    const core=require('../WebApp/map-vehicle-canvas-core.js');
    assert.equal(global.GH_MAP_VEHICLE_CANVAS,core);assert.equal(core.MAX_VEHICLES,300);
    testSingleCanvasCapAndPool(core,environment);
    environment.document.created=[];
    testHitTestingSelectionAndDeterminism(core,environment);
    environment.document.created=[];
    testSpriteFallback(core,environment);
    console.log(JSON.stringify({suite:'build359-map-canvas-layer',passed:7,total:7,checks:['single-canvas','hard-cap-300','slot-pool-reuse','DPR-cap','hit-testing','deterministic-draw','listener-teardown-and-sprite-fallback']},null,2));
  }finally{environment.restore();}
})().catch(error=>{console.error(error);process.exitCode=1;});
