// Convert MIT Rocketbox FBX to baked, metered glTF. Runtime uses no FBX files or network.
window.bakeCast=async function(){
 const T=CONVERT, output=new T.Group();
 const pngBlank='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
 for(const [name,key] of [['Business_Male_01','host'],['Business_Male_07','guest'],['Business_Female_02','guest2']]){
  const manager=new T.LoadingManager();manager.setURLModifier(()=>pngBlank);
  const model=new T.FBXLoader(manager).parse(await(await fetch(name+'.fbx')).arrayBuffer(),'');
  const bones={};model.traverse(o=>{if(o.isBone)bones[o.name]=o;});
  const original=new Map(Object.values(bones).map(o=>[o,o.quaternion.clone()]));
  const aim=(suffix,childSuffix,xyz)=>{const bone=bones['Bip01_'+suffix],child=bones['Bip01_'+childSuffix];if(!bone||!child)return;model.updateMatrixWorld(true);const from=child.getWorldPosition(new T.Vector3()).sub(bone.getWorldPosition(new T.Vector3())).normalize();const delta=new T.Quaternion().setFromUnitVectors(from,new T.Vector3(...xyz).normalize());const desired=delta.multiply(bone.getWorldQuaternion(new T.Quaternion()));bone.quaternion.copy(bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(desired));model.updateMatrixWorld(true);};
  const materials=new Map();
  for(const pose of ['standing','seated']){
   for(const [bone,q] of original)bone.quaternion.copy(q);
   for(const side of ['L','R']){const sign=side==='L'?1:-1;
    aim(side+'_UpperArm',side+'_Forearm',[sign*.15,-.98,.1]);
    aim(side+'_Forearm',side+'_Hand',pose==='seated'?[sign*-.05,-.2,.96]:[sign*-.12,-.82,.56]);
    if(pose==='seated'){aim(side+'_Thigh',side+'_Calf',[sign*.08,-.04,1]);aim(side+'_Calf',side+'_Foot',[0,-1,.02]);aim(side+'_Foot',side+'_Toe0',[0,-.05,1]);}
   }
   model.updateMatrixWorld(true);model.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
   const group=new T.Group();group.name=key+'_'+pose;const meshes=[];model.traverse(o=>{if(o.isMesh)meshes.push(o);});
   for(const mesh of meshes){
    const geometry=mesh.geometry.clone(),position=geometry.attributes.position,v=new T.Vector3();
    for(let i=0;i<position.count;i++){mesh.getVertexPosition(i,v);v.applyMatrix4(mesh.matrixWorld).multiplyScalar(.01);position.setXYZ(i,v.x,v.y,v.z);}
    geometry.deleteAttribute('skinIndex');geometry.deleteAttribute('skinWeight');geometry.deleteAttribute('normal');geometry.computeVertexNormals();
    const originals=Array.isArray(mesh.material)?mesh.material:[mesh.material],mats=[];
    for(const material of originals){
     if(!materials.has(material.name)){
      const texture=await new T.TextureLoader().loadAsync(material.name.replace('_glasses','_glasses_opacity')+'_color.png');texture.colorSpace=T.SRGBColorSpace;if(!material.name.includes('opacity')&&!material.name.includes('glasses'))texture.userData.mimeType='image/jpeg';
      const mat=new T.MeshStandardMaterial({name:material.name,map:texture,color:0xffffff,metalness:0,roughness:.86,alphaTest:material.name.includes('opacity')?.45:0,side:T.DoubleSide});materials.set(material.name,mat);
     }
     mats.push(materials.get(material.name));
    }
    group.add(new T.Mesh(geometry,mats));
   }
   const box=new T.Box3().setFromObject(group);const center=box.getCenter(new T.Vector3());
   // Center on the pelvis, preserve horizontal seat depth and align shoes to floor.
   for(const mesh of group.children)mesh.geometry.translate(-center.x,-box.min.y,0);
   output.add(group);
  }
 }
 const glb=await new T.GLTFExporter().parseAsync(output,{binary:true,onlyVisible:true,maxTextureSize:1024});
 return {bytes:Array.from(new Uint8Array(glb)),summary:output.children.map(g=>({name:g.name,box:new T.Box3().setFromObject(g).getSize(new T.Vector3()).toArray()}))};
};
