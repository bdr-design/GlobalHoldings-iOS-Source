'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const web=path.resolve(__dirname,'../WebApp');
const controller=fs.readFileSync(path.join(web,'conference-3d.js'),'utf8');
const world=fs.readFileSync(path.join(web,'conference-world.js'),'utf8');
const css=fs.readFileSync(path.join(web,'conference-3d.css'),'utf8');

// The conference is a fixed-angle HTML presentation. Preserve the legacy API
// identifier for saved-session compatibility while asserting the runtime is 2D.
for(const source of [controller,world]){
  assert.doesNotMatch(source,/\brequestAnimationFrame\s*\(/,'a static conference must not schedule animation frames');
  assert.doesNotMatch(source,/\bWebGLRenderer\b|\bGH_THREE\b|\bCanvasTexture\b|\bInstancedMesh\b/,'conference runtime must not load or create Three/WebGL resources');
}
assert.match(controller,/engine:'GH-CONFERENCE-2D'/);
assert.match(controller,/webglFrames:0,scheduledFrame:false/);
assert.match(controller,/drawCalls:0,triangles:0,geometries:0,textures:0/);
assert.match(controller,/staticPresenter:true/);

// Match the supplied landscape composition: content screen centered in the
// auditorium, presenter fixed on its right, with three CSS-only camera angles.
assert.match(css,/\.ghc3-screen-frame\{position:absolute;z-index:2;left:22\.53%;top:11\.27%;width:55\.10%;height:61\.27%/);
assert.match(css,/\.ghc3-static-presenter\{position:absolute;z-index:3;top:57%;right:8\.2%;width:5\.5%;height:20%/);
assert.match(css,/\.ghc3\[data-angle="wide"\].*\.ghc3-screen-frame/s);
assert.match(css,/\.ghc3\[data-angle="stage"\].*\.ghc3-screen-frame/s);
assert.match(world,/this\.viewport\.append\(this\.presenterArtwork,this\.presenter\)/,'the static presenter remains layered at the stage on the right');
assert.match(world,/dispose\(\)\{if\(this\.disposed\)return;this\.disposed=true;this\.brandObserver\?\.disconnect\(\);this\.art\.remove\(\);this\.presenterArtwork\.remove\(\);this\.presenter\.remove\(\);\}/,'closing the conference disconnects observers and releases static DOM elements');

console.log(JSON.stringify({suite:'build359-conference-thermal',runtime:'static-2d',scheduledFrames:0,webglResources:0,screen:'landscape-centered',presenter:'static-right',angles:3}));
