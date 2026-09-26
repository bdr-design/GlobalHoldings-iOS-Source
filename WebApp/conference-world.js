/* Build 334: bright executive auditorium, asset-backed people and explicit GPU ownership. */
(()=>{'use strict';
let castSource=null;
function ensureCast(){
 if(globalThis.GH_CONFERENCE_CAST_GLB)return Promise.resolve();
 if(castSource)return castSource;
 castSource=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='assets/conference/rocketbox-cast.js';script.onload=()=>{script.remove();if(globalThis.GH_CONFERENCE_CAST_GLB)resolve();else{castSource=null;reject(new Error('conference-cast-missing'));}};script.onerror=()=>{script.remove();castSource=null;reject(new Error('conference-cast-unavailable'));};document.head.appendChild(script);});return castSource;
}

class ResourcePool{
 constructor(){this.items=new Set();this.closed=false;}
 own(resource){if(this.closed){if(resource?.isTexture)resource.source?.data?.close?.();resource?.dispose?.();return resource;}this.items.add(resource);return resource;}
 dispose(){this.closed=true;for(const resource of this.items){if(resource.isTexture)resource.source?.data?.close?.();resource.dispose?.();}this.items.clear();}
}
class Auditorium{
 constructor(renderer,redraw){this.T=globalThis.GH_THREE;this.renderer=renderer;this.redraw=redraw;this.pool=new ResourcePool();this.disposed=false;this.crowdCount=0;this.scene=new this.T.Scene();this.presenterCue='stage-right';this.build();}
 own(x){return this.pool.own(x);}
 material(color,roughness=.8,metalness=0){return this.own(new this.T.MeshStandardMaterial({color,roughness,metalness}));}
 mesh(geo,mat,position=[0,0,0],scale=[1,1,1]){const o=new this.T.Mesh(geo,mat);o.position.set(...position);o.scale.set(...scale);o.receiveShadow=true;this.scene.add(o);return o;}
 build(){
  const T=this.T,s=this.scene;s.background=new T.Color('#dbeaf3');s.fog=new T.Fog('#dbeaf3',58,104);
  const m=this.materials={floor:this.material('#c9bea9',.9),white:this.material('#fffdf7',.66),wall:this.material('#e5edf1',.9),fabric:this.material('#234d70',.91),metal:this.material('#b8a16f',.3,.58),dark:this.material('#0b3551',.68),blue:this.material('#286fe8',.46),teal:this.material('#0e9f96',.48),gold:this.material('#d3a241',.38,.42),light:this.own(new T.MeshBasicMaterial({color:'#fff5d9',toneMapped:false}))};
  const cube=this.own(new T.BoxGeometry(1,1,1)),round=this.own(new T.RoundedBoxGeometry(1,1,1,3,.12));
  const box=(pos,scale,mat,rounded=false)=>this.mesh(rounded?round:cube,mat,pos,scale);
  box([0,-.25,6],[38,.4,52],m.floor);box([0,6.5,-12.4],[38,13,.5],m.wall);
  // Floating rounded stage; wide white LED wall without a picture frame.
  box([0,.04,-6.5],[29,.3,12],m.white,true);box([0,.28,-6.9],[28,.2,11.2],m.white,true);
  box([0,.16,-.51],[27.5,.035,.035],m.teal);box([0,.39,-1.3],[26.5,.035,.035],m.gold);
  box([0,6.12,-11.55],[24.3,10.86,.22],m.white,true);
  this.screenCanvas=document.createElement('canvas');const limit=this.renderer.capabilities.maxTextureSize;this.screenCanvas.width=Math.min(3840,limit);this.screenCanvas.height=Math.min(2160,limit);
  this.screenTexture=this.own(new T.CanvasTexture(this.screenCanvas));this.screenTexture.colorSpace=T.SRGBColorSpace;this.screenTexture.anisotropy=Math.min(this.renderer.capabilities.getMaxAnisotropy(),16);
  const screenMat=this.own(new T.MeshBasicMaterial({map:this.screenTexture,toneMapped:false}));
  this.screen=this.mesh(this.own(new T.PlaneGeometry(24,10.8)),screenMat,[0,6.12,-11.4]);
  // Sculpted wings instead of vertical wooden fins. Curved surfaces carry soft cool lighting.
  for(const side of [-1,1]){
   const wing=this.mesh(this.own(new T.CylinderGeometry(5.5,5.5,11,48,1,true,0,Math.PI*.6)),m.white,[side*19,5.75,-9.8]);wing.rotation.y=side<0?Math.PI*.5:-Math.PI*.9;wing.material.side=T.DoubleSide;
   box([side*17.8,6,8],[.28,12,40],m.wall);
   box([side*17.62,2.6,6],[.025,.07,34],m.light);
   box([side*16.8,.05,7],[.4,.015,32],side<0?m.blue:m.teal,true);
  }
  const skyCanvas=document.createElement('canvas');skyCanvas.width=32;skyCanvas.height=256;const skyCtx=skyCanvas.getContext('2d'),gradient=skyCtx.createLinearGradient(0,0,0,256);gradient.addColorStop(0,'#94bce8');gradient.addColorStop(.64,'#e2eef9');gradient.addColorStop(1,'#f4f7fb');skyCtx.fillStyle=gradient;skyCtx.fillRect(0,0,32,256);const skyTexture=this.own(new T.CanvasTexture(skyCanvas));skyTexture.colorSpace=T.SRGBColorSpace;const skyMaterial=this.own(new T.MeshBasicMaterial({map:skyTexture,toneMapped:false}));
  for(let i=0;i<5;i++){const z=-3+i*6.4;const panel=this.mesh(this.own(new T.PlaneGeometry(5.9,7.3)),skyMaterial,[-17.59,6.6,z]);panel.rotation.y=Math.PI/2;box([-17.5,2.9,z],[.3,.16,6.1],m.white,true);}
  for(let i=0;i<8;i++)box([0,-.038,2+i*4],[35,.008,.018],m.metal);
  // Suspended luminous rings and shallow acoustic baffles.
  const ring=this.own(new T.TorusGeometry(1,.022,6,90));
  for(const [z,rx,rz] of [[-5,12,5],[7,13,7],[22,13,7]]){const o=this.mesh(ring,m.light,[0,12,z],[rx,rz,1]);o.rotation.x=Math.PI/2;}
  for(let i=0;i<5;i++)box([0,12.3,-5+i*7],[31,.16,.8],m.white,true);
  // An open stage keeps the full presenter visible; no lectern obstructs the body.
  this.createSeats(round,cube,m);this.batch(cube);this.batch(round);
  s.add(new T.HemisphereLight('#fffdf7','#7891a4',1.45));const key=new T.DirectionalLight('#fff4d9',2.85);key.position.set(-7,14,10);key.castShadow=true;key.shadow.mapSize.set(1536,1536);Object.assign(key.shadow.camera,{left:-19,right:19,top:30,bottom:-20,near:1,far:80});key.shadow.bias=-.0007;key.shadow.normalBias=.045;this.own(key.shadow);s.add(key);
  const fill=new T.DirectionalLight('#d7ebff',.95);fill.position.set(15,7,-5);s.add(fill);const stageGlow=new T.PointLight('#cceeff',.65,35);stageGlow.position.set(0,8,-2);s.add(stageGlow);
 }
 createSeats(round,cube,m){
  const T=this.T,matrix=new T.Object3D();this.seats=[];
  for(let r=0;r<7;r++)for(let c=0;c<14;c++){
   const x=(c-6.5)*1.03+(c<7?-.9:.9),z=3.6+r*1.6+Math.abs(x)*.075,y=r*.12;
   this.seats.push({x,y,z,angle:-x*.012,occupied:(r*13+c*7)%9!==0,seed:r*14+c});
  }
  const parts=[{geo:round,mat:m.fabric,s:[.66,.14,.64],p:[0,.47,0]},{geo:round,mat:m.fabric,s:[.68,.61,.11],p:[0,.81,.28],rot:-.12},{geo:cube,mat:m.metal,s:[.035,.4,.045],p:[-.24,.22,0]},{geo:cube,mat:m.metal,s:[.035,.4,.045],p:[.24,.22,0]},{geo:round,mat:m.metal,s:[.045,.065,.55],p:[-.37,.7,0]},{geo:round,mat:m.metal,s:[.045,.065,.55],p:[.37,.7,0]}];
  for(const part of parts){const batch=this.own(new T.InstancedMesh(part.geo,part.mat,this.seats.length));this.seats.forEach((seat,i)=>{matrix.position.set(seat.x+part.p[0],seat.y+part.p[1],seat.z+part.p[2]);matrix.scale.set(...part.s);matrix.rotation.set(part.rot||0,seat.angle,0);matrix.updateMatrix();batch.setMatrixAt(i,matrix.matrix);});batch.receiveShadow=true;batch.castShadow=part.mat===m.fabric;this.scene.add(batch);}
  for(let r=0;r<7;r++){this.mesh(cube,m.floor,[0,r*.06-.02,3.6+r*1.6],[20,.12+r*.12,1.6]);for(const x of [-9,0,9])this.mesh(cube,m.light,[x,r*.12+.045,3.6+r*1.6],[.05,.014,1.15]);}
 }
 batch(geometry){const T=this.T,groups=new Map();for(const mesh of [...this.scene.children])if(mesh.isMesh&&!mesh.isInstancedMesh&&mesh.geometry===geometry){const rows=groups.get(mesh.material)||[];rows.push(mesh);groups.set(mesh.material,rows);}for(const [mat,rows] of groups){const batch=this.own(new T.InstancedMesh(geometry,mat,rows.length));rows.forEach((mesh,i)=>{mesh.updateMatrix();batch.setMatrixAt(i,mesh.matrix);this.scene.remove(mesh);});batch.receiveShadow=true;this.scene.add(batch);}}
 async loadCast(){
  await ensureCast();if(this.disposed)return;
  const T=this.T,raw=atob(globalThis.GH_CONFERENCE_CAST_GLB||''),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(bytes.length<1000)throw new Error('conference-cast-missing');
  const gltf=await new T.GLTFLoader().parseAsync(bytes.buffer,'');
  gltf.scene.traverse(o=>{if(o.isMesh){this.own(o.geometry);for(const mat of Array.isArray(o.material)?o.material:[o.material]){this.own(mat);for(const value of Object.values(mat))if(value?.isTexture)this.own(value);}}});
  if(this.disposed)return;
  const host=gltf.scene.getObjectByName('host_standing');if(!host)throw new Error('conference-cast-invalid');this.host=host;host.position.set(7.15,.39,-4.1);host.rotation.y=-.12;host.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});this.scene.add(host);this.applyCue({presenter:this.presenterCue},{phase:'opening',immediate:true});
  const matrix=new T.Object3D();const models=['host_seated','guest_seated','guest2_seated'];
  models.forEach((name,k)=>{const seats=this.seats.filter(p=>p.occupied&&p.seed%3===k),model=gltf.scene.getObjectByName(name);if(!model)throw new Error('conference-cast-invalid');model.updateMatrixWorld(true);
   model.traverse(o=>{if(!o.isMesh)return;const batch=this.own(new T.InstancedMesh(o.geometry,o.material,seats.length));seats.forEach((p,i)=>{const size=.97+(p.seed%5)*.012;matrix.position.set(p.x,p.y+.055,p.z+.04);matrix.rotation.set(0,Math.PI+p.angle+(p.seed%3-1)*.035,0);matrix.scale.set(size,size,size);matrix.updateMatrix();batch.setMatrixAt(i,matrix.matrix);});batch.receiveShadow=true;batch.castShadow=true;this.scene.add(batch);});this.crowdCount+=seats.length;
  });
  this.renderer.shadowMap.needsUpdate=true;this.redraw();
 }
 paint(board){board.draw(this.screenCanvas,()=>{if(!this.disposed){this.paint(board);this.redraw();}});this.screenTexture.needsUpdate=true;}
 applyCue(cue={},meta={}){const key=['entrance','stage-right','center','screen-left'].includes(cue.presenter)?cue.presenter:'stage-right';this.presenterCue=key;if(!this.host)return;const points={entrance:[11.5,.39,-1.6], 'stage-right':[7.15,.39,-4.1],center:[0,.39,-4.5],'screen-left':[-7.1,.39,-4.1]},to=points[key],from=[this.host.position.x,this.host.position.y,this.host.position.z];if(meta.immediate||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches){this.host.position.set(...to);this.host.rotation.y=key==='screen-left'?.12:key==='center'?0:-.12;this.presenterMotion=null;this.redraw();return;}this.presenterMotion={start:performance.now(),duration:900,from,to,rotationFrom:this.host.rotation.y,rotationTo:key==='screen-left'?.12:key==='center'?0:-.12};this.redraw();}
 update(time){const motion=this.presenterMotion;if(!motion||!this.host)return false;const p=Math.min(1,Math.max(0,(time-motion.start)/motion.duration)),e=p*p*(3-2*p);this.host.position.set(motion.from[0]+(motion.to[0]-motion.from[0])*e,motion.from[1]+(motion.to[1]-motion.from[1])*e,motion.from[2]+(motion.to[2]-motion.from[2])*e);this.host.rotation.y=motion.rotationFrom+(motion.rotationTo-motion.rotationFrom)*e;if(p>=1)this.presenterMotion=null;return p<1;}
 target(view,aspect){const T=this.T;let pos,look;
  if(view==='screen'){look=[0,6.12,-11.4];const dist=Math.max(15,14.2/Math.max(.4,aspect)/Math.tan(38*Math.PI/360));pos=[0,6.12,-11.4+dist];}
  else if(view==='host'){look=[7.12,1.62,-4.1];pos=[8.1,2.02,1.45];}
  else if(view==='podium'){look=[0,5.1,-8];pos=aspect<1?[3.2,7.2,37]:[6.2,5.1,14];}
  else{look=[0,4,-3];pos=aspect<1?[0,10.5,49]:[-10.5,9.4,21.5];}
  return{pos:new T.Vector3(...pos),look:new T.Vector3(...look)};
 }
 dispose(){this.disposed=true;this.presenterMotion=null;this.pool.dispose();this.scene.clear();}
}
globalThis.GH_CONF_WORLD=Object.freeze({Auditorium,ResourcePool});
})();
