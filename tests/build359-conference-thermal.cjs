'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const controllerSource=fs.readFileSync(path.join(root,'WebApp/conference-3d.js'),'utf8');
const worldSource=fs.readFileSync(path.join(root,'WebApp/conference-world.js'),'utf8');

assert.match(controllerSource,/motionFrameMs=1000\/30/,'conference motion must be capped at 30fps');
assert.match(controllerSource,/cameraView==='screen'/,'data view must suppress WebGL rendering');
assert.match(controllerSource,/pixelRatioCap=this\.isPhone\?1\.75:2/,'DPR caps must be explicit');
assert.match(worldSource,/this\.mobile\?\[1920,1080\]:\[3840,2160\]/,'phone screen texture must be capped at 1080p');
assert.match(worldSource,/this\.mobile\?1024:1536/,'phone shadow map must be capped at 1024');
assert.match(worldSource,/batch\.castShadow=!this\.mobile/,'audience shadows must be disabled on phones');

function controllerHarness(userAgent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'){
 let clock=1000,nextId=1;
 const raf=new Map(),timers=new Map(),cancelledRaf=[],cancelledTimers=[];
 const context={
  console,
  navigator:{userAgent},
  devicePixelRatio:3,
  performance:{now:()=>clock},
  document:{hidden:false,fonts:{check:()=>true}},
  matchMedia:query=>({matches:query.includes('pointer: coarse')}),
  getComputedStyle:element=>element.styleState||{display:'block',visibility:'visible',opacity:'1'},
  requestAnimationFrame:callback=>{const id=nextId++;raf.set(id,callback);return id;},
  cancelAnimationFrame:id=>{cancelledRaf.push(id);raf.delete(id);},
  setTimeout:(callback,delay)=>{const id=nextId++;timers.set(id,{callback,delay});return id;},
  clearTimeout:id=>{cancelledTimers.push(id);timers.delete(id);},
  GH_CONF_MODEL:{
   esc:value=>String(value??''),clone:value=>structuredClone(value),freeze:value=>Object.freeze(value),number:value=>Number(value)||0,
   buildScenePlan:()=>[{id:'opening',title:'Opening',presenter:'Host',role:'CEO',type:'group',metrics:[],narration:{durationMs:0,lines:[]},cues:{}}]
  }
 };
 context.globalThis=context;
 const exposed=controllerSource.replace('function launch(config,options={})','globalThis.__ConferenceSession=ConferenceSession;\nfunction launch(config,options={})');
 vm.runInNewContext(exposed,context,{filename:'conference-3d.js'});
 return{
  context,raf,timers,cancelledRaf,cancelledTimers,
  setClock:value=>{clock=value;},
  runRaf(time=clock){const entry=raf.entries().next().value;assert(entry,'expected a queued animation frame');const [id,callback]=entry;raf.delete(id);callback(time);},
  runTimer(){const entry=timers.entries().next().value;assert(entry,'expected a queued frame timer');const [id,row]=entry;timers.delete(id);row.callback();return row.delay;}
 };
}

function attachRenderMocks(harness){
 const Session=harness.context.__ConferenceSession;
 const session=new Session({snapshot:{group:{name:'MADAR'}}},{mode:'manual'});
 const viewport={styleState:{display:'block',visibility:'visible',opacity:'1'},getBoundingClientRect:()=>({width:390,height:844})};
 const rootElement={hidden:false,styleState:{display:'block',visibility:'visible',opacity:'1'},dataset:{view:'screen'},querySelector:selector=>selector==='.ghc3-viewport'?viewport:null};
 const canvas={hidden:false,styleState:{display:'block',visibility:'visible',opacity:'1'}};
 let renders=0,worldActive=false;
 Object.assign(session,{assetsReady:true,root:rootElement,canvas,scene:{},camera:{},renderer:{render:()=>{renders++;}},world:{update:()=>worldActive}});
 return{session,viewport,rootElement,canvas,renders:()=>renders,setWorldActive:value=>{worldActive=value;}};
}

const phone=controllerHarness();
const runtime=attachRenderMocks(phone);
assert.equal(runtime.session.isPhone,true);
assert.equal(runtime.session.pixelRatio,1.75);

runtime.session.requestFrame();
assert.equal(phone.raf.size,0,'screen/data mode must not queue RAF');
assert.equal(phone.timers.size,0,'screen/data mode must not queue a delayed frame');
assert.equal(runtime.renders(),0,'screen/data mode must not call renderer.render');

runtime.session.cameraView='wide';runtime.rootElement.dataset.view='wide';runtime.session.requestFrame();
assert.equal(phone.raf.size,1,'visible 3D view should queue one RAF');
phone.runRaf(1000);
assert.equal(runtime.renders(),1);
assert.equal(phone.raf.size,0,'idle view must leave no RAF queued');
assert.equal(phone.timers.size,0,'idle view must leave no frame timer queued');

phone.setClock(1005);runtime.session.requestFrame();
assert.equal(phone.raf.size,0,'30fps pacing must not queue an early RAF');
assert.equal(phone.timers.size,1,'30fps pacing should delay the next visual frame');
const delay=phone.runTimer();assert(delay>=28&&delay<=29,'30fps delay must preserve a ~33ms cadence');
phone.setClock(1034);phone.runRaf(1034);assert.equal(runtime.renders(),2);

runtime.canvas.styleState.visibility='hidden';phone.setClock(1100);runtime.session.requestFrame();
assert.equal(phone.raf.size,0);assert.equal(phone.timers.size,0);assert.equal(runtime.renders(),2,'hidden canvas must not render');
runtime.canvas.styleState.visibility='visible';runtime.viewport.getBoundingClientRect=()=>({width:0,height:0});runtime.session.requestFrame();
assert.equal(phone.raf.size,0,'zero-area viewport must not queue RAF');
runtime.viewport.getBoundingClientRect=()=>({width:390,height:844});

runtime.setWorldActive(true);phone.setClock(1200);runtime.session.requestFrame();phone.runRaf(1200);
assert.equal(phone.timers.size,1,'active motion should schedule the next 30fps frame');
runtime.session.cameraView='screen';runtime.rootElement.dataset.view='screen';runtime.session.requestFrame();
assert.equal(phone.raf.size,0);assert.equal(phone.timers.size,0,'switching to data view must cancel real RAF/timer work');
assert(phone.cancelledTimers.length>0,'pending motion timer must be cancelled');

const desktop=controllerHarness('Mozilla/5.0 (Macintosh; Intel Mac OS X)');
desktop.context.matchMedia=()=>({matches:false});
const desktopRuntime=attachRenderMocks(desktop);
assert.equal(desktopRuntime.session.isPhone,false);assert.equal(desktopRuntime.session.pixelRatio,2);

function vector(){return{x:0,y:0,z:0,set(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;return this;}};}
class Disposable{dispose(){this.disposed=true;}}
class Geometry extends Disposable{}
class Material extends Disposable{constructor(options={}){super();Object.assign(this,options);}}
class Mesh extends Disposable{constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.position=vector();this.scale=vector();this.rotation=vector();this.isMesh=true;this.matrix={};}updateMatrix(){this.matrix={updated:true};}}
class InstancedMesh extends Mesh{constructor(geometry,material,count){super(geometry,material);this.count=count;this.isInstancedMesh=true;}setMatrixAt(){}}
class Object3D{constructor(){this.position=vector();this.scale=vector();this.rotation=vector();this.matrix={};}updateMatrix(){this.matrix={updated:true};}}
class Scene{constructor(){this.children=[];}add(object){this.children.push(object);}remove(object){this.children=this.children.filter(row=>row!==object);}clear(){this.children=[];}}
class CanvasTexture extends Disposable{constructor(canvas){super();this.canvas=canvas;this.isTexture=true;this.source={data:canvas};}}
class DirectionalLight{constructor(){this.position=vector();this.shadow={mapSize:{set:(width,height)=>{this.shadowSize=[width,height];}},camera:{},dispose(){}};}}
class PlainLight{constructor(){this.position=vector();}}
const Three={
 Scene,Color:class{},Fog:class{},MeshStandardMaterial:Material,MeshBasicMaterial:Material,BoxGeometry:Geometry,RoundedBoxGeometry:Geometry,
 Mesh,PlaneGeometry:Geometry,CylinderGeometry:Geometry,TorusGeometry:Geometry,InstancedMesh,Object3D,CanvasTexture,
 HemisphereLight:PlainLight,DirectionalLight,PointLight:PlainLight,DoubleSide:2,SRGBColorSpace:'srgb'
};
function worldHarness(mobile){
 const canvases=[];
 const context={console,GH_THREE:Three,document:{createElement(tag){assert.equal(tag,'canvas');const canvas={width:0,height:0,getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),fillRect(){},set fillStyle(value){this._fillStyle=value;}})};canvases.push(canvas);return canvas;}},atob:()=>'',performance:{now:()=>0},matchMedia:()=>({matches:false})};
 context.globalThis=context;vm.runInNewContext(worldSource,context,{filename:'conference-world.js'});
 const renderer={capabilities:{maxTextureSize:4096,getMaxAnisotropy:()=>16},shadowMap:{needsUpdate:false}};
 const auditorium=new context.GH_CONF_WORLD.Auditorium(renderer,()=>{}, {mobile});
 const key=auditorium.scene.children.find(row=>row instanceof DirectionalLight);
 return{auditorium,key};
}
const mobileWorld=worldHarness(true);
assert.deepEqual([mobileWorld.auditorium.screenCanvas.width,mobileWorld.auditorium.screenCanvas.height],[1920,1080]);
assert.deepEqual(mobileWorld.key.shadowSize,[1024,1024]);
assert(mobileWorld.auditorium.scene.children.filter(row=>row.isInstancedMesh).every(row=>!row.castShadow),'phone seat batches must not cast shadows');
mobileWorld.auditorium.dispose();assert.equal(mobileWorld.auditorium.pool.items.size,0,'mobile resources must still dispose');

const desktopWorld=worldHarness(false);
assert.deepEqual([desktopWorld.auditorium.screenCanvas.width,desktopWorld.auditorium.screenCanvas.height],[3840,2160]);
assert.deepEqual(desktopWorld.key.shadowSize,[1536,1536]);
assert(desktopWorld.auditorium.scene.children.some(row=>row.isInstancedMesh&&row.castShadow),'desktop quality should retain seat shadows');
desktopWorld.auditorium.dispose();assert.equal(desktopWorld.auditorium.pool.items.size,0,'desktop resources must still dispose');

console.log(JSON.stringify({ok:true,screenRenderCalls:0,motionFps:30,phoneDprCap:1.75,desktopDprCap:2,phoneTexture:[1920,1080],phoneShadow:[1024,1024],idleRafStopped:true,lifecycleDispose:true},null,2));
