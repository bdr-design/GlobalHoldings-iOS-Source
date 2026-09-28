'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const Model=require(path.resolve(__dirname,'../WebApp/conference-model.js'));
require(path.resolve(__dirname,'../WebApp/conference-board.js'));

const comments=[
 {handle:'@RiyadhMarkets',country:'السعودية',text:'عرض سنوي مرتب والأرقام التشغيلية أوضح من السنة الماضية.'},
 {handle:'@GlobalCapitalDesk',country:'الولايات المتحدة',text:'The portfolio is growing, but investors will focus on margin discipline and cash generation.'},
 {handle:'@CityInfraWatch',country:'المملكة المتحدة',text:'Debt and funding costs will be closely watched after this presentation.'}
];
const snapshot={year:2026,group:{name:'Global Holdings'},companies:[],social:{attendees:1420,viewers:2210,positive:64,posts:53,comments}};
const scene=Model.buildScenePlan(snapshot).find(row=>row.kind==='audience');
const element={innerHTML:''},board=new globalThis.GH_CONF_BOARD.Board(element);
board.update(snapshot,scene);
for(const comment of comments)assert(element.innerHTML.includes(Model.esc(comment.text)),'HTML board must retain each audience comment');

const strokes=[],cards=[];
const ctx={font:'',save(){},restore(){},scale(){},fillRect(){},beginPath(){},roundRect(x,y,width,height){cards.push({x,y,width,height});},fill(){},measureText(value){return{width:Array.from(String(value)).length*Number(/(\d+)px/.exec(this.font)?.[1]||42)*.57};},fillText(value,x,y){strokes.push({text:String(value),x,y});}};
board.draw({width:2400,height:1080,getContext:()=>ctx});
const commentCards=cards.filter(card=>card.x===132&&card.width===1225);
assert.equal(commentCards.length,3,'audience comments should each have their own canvas card');
for(let i=0;i<comments.length;i++){
 const card=commentCards[i],next=commentCards[i+1];
 const strokesInCard=strokes.filter(stroke=>stroke.x>=card.x&&stroke.x<=card.x+card.width&&stroke.y>=card.y&&stroke.y<=card.y+card.height);
 assert(strokesInCard.some(stroke=>stroke.text.includes(comments[i].handle)),`comment ${i+1} has a visible author`);
 const lines=strokesInCard.filter(stroke=>!stroke.text.includes(comments[i].handle));
 assert(lines.length>=1&&lines.length<=2,`comment ${i+1} stays within two text lines`);
 assert.equal(lines.map(line=>line.text).join(' ').replace(/\s+/g,' '),comments[i].text,`comment ${i+1} is not truncated`);
 assert(lines.at(-1).y<=card.y+card.height-8,`comment ${i+1} stays inside its card`);
 if(next)assert(lines.at(-1).y<next.y,`comment ${i+1} cannot overlap the next comment`);
}
assert(commentCards.at(-1).y+commentCards.at(-1).height<969,'comments fit within the canvas chart');
console.log('conference audience comments fit the 3D board without overlap or truncation');
