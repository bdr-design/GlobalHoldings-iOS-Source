'use strict';

// Build 359 (owner report from iPhone with a screenshot: "numbers and clutter all over the map"): the map follows the
// airline-manager model. Three modes, each with one job:
// - operations: moving assets as small vehicles on thin route lines, no count badges; parked assets are counted in
//   their base (tap the base);
// - network: the group's places (bases, hubs, HQ); only places are grouped, in one bubble style with a count;
// - expansion: the world's airports and ports to open, grouped the same way, the group's places always shown.
// Pure helpers (no Leaflet, no state) so the rules are tested on their own: one numeral style (Western, compact above
// 999), screen-space grouping that keeps a group on a real place (its heaviest member), decluttering that drops what
// would overlap instead of stacking it, and route line weight by traffic.
((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_MAP_VIEW_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const VERSION='GH-MAP-VIEW-359.2.0';
  const MODES=Object.freeze([
    Object.freeze({id:'operations',label:'العمليات',hint:'الأصول المتحركة ومساراتها'}),
    Object.freeze({id:'network',label:'الشبكة',hint:'القواعد والمحاور والمقار'}),
    Object.freeze({id:'expansion',label:'التوسع',hint:'المطارات والموانئ المتاحة'})
  ]);
  const MODE_IDS=new Set(MODES.map(mode=>mode.id));
  const normalizeMode=value=>MODE_IDS.has(value)?value:'operations';
  const COMPACT=new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1});
  // One numeral style on the map: Western digits, compact above 999 (12, 999, 1K, 3.4K, 1.2M).
  function countLabel(value){
    const n=Math.max(0,Math.round(Number(value)||0));
    return n<1000?String(n):COMPACT.format(n);
  }
  const finite=point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.y);
  // Grid hash over screen points: neighbours of a point are looked up in the 3×3 cells around it.
  function grid(size){
    const cells=new Map(),key=(cx,cy)=>`${cx}:${cy}`;
    return {
      add(entry){const cx=Math.floor(entry.x/size),cy=Math.floor(entry.y/size),k=key(cx,cy);let list=cells.get(k);if(!list){list=[];cells.set(k,list);}list.push(entry);},
      near(x,y,radius){
        const cx=Math.floor(x/size),cy=Math.floor(y/size),r2=radius*radius;
        for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const list=cells.get(key(cx+dx,cy+dy));if(!list)continue;for(const entry of list){const ex=entry.x-x,ey=entry.y-y;if(ex*ex+ey*ey<r2)return entry;}}
        return null;
      }
    };
  }
  const byWeight=(a,b)=>(Number(b.weight)||1)-(Number(a.weight)||1)||String(a.id??'').localeCompare(String(b.id??''));
  // Groups screen points closer than `radius` px. Heaviest first: a group stands where its heaviest member is (a real
  // place, never an average of several), and its count is the sum of member weights.
  function groupPoints(points,{radius=44}={}){
    const sorted=(Array.isArray(points)?points:[]).filter(finite).slice().sort(byWeight),index=grid(Math.max(1,radius)),groups=[];
    for(const point of sorted){
      const weight=Math.max(1,Number(point.weight)||1),host=index.near(point.x,point.y,radius);
      if(host){host.count+=weight;host.members.push(point);continue;}
      const group={x:point.x,y:point.y,id:point.id,anchor:point,count:weight,members:[point]};index.add(group);groups.push(group);
    }
    return groups;
  }
  // Keeps points in priority order and drops any that would overlap a kept one (no stacking, no merged count).
  function declutter(points,{radius=26,limit=Infinity}={}){
    const sorted=(Array.isArray(points)?points:[]).filter(finite).slice().sort(byWeight),index=grid(Math.max(1,radius)),kept=[];
    for(const point of sorted){if(kept.length>=limit)break;if(index.near(point.x,point.y,radius))continue;index.add(point);kept.push(point);}
    return kept;
  }
  // Route lines: the busiest routes in view, weight and opacity by traffic on a log scale (a route with one asset is a
  // hairline, the busiest route about 3 px).
  function routeStyle(count,maxCount){
    const c=Math.max(1,Number(count)||1),m=Math.max(c,Number(maxCount)||1),t=m>1?Math.log(c)/Math.log(m):1;
    return {weight:Math.round((1.1+2.1*t)*10)/10,opacity:Math.round((.32+.43*t)*100)/100};
  }
  function busiestRoutes(routes,limit){
    return (Array.isArray(routes)?routes:[]).filter(route=>(Number(route?.count)||0)>0).slice().sort((a,b)=>b.count-a.count||String(a.key).localeCompare(String(b.key))).slice(0,Math.max(0,limit));
  }
  // Vehicles share one adaptive presentation budget across the owned fleet, Mobility and competitors.  The cap is a
  // rendering concern only: it never changes the logical fleet, accounting or simulation.  Places use a separate DOM
  // budget because facilities remain interactive Leaflet markers and are presented through country/city hierarchy.
  function budget(kind,zoom){
    const z=Number(zoom)||0;
    if(kind==='routes')return z<4?40:z<6?70:z<9?110:160;
    if(kind==='vehicles')return z<4?72:z<6?120:z<9?200:300;
    if(kind==='places')return z<4?28:z<6?48:z<9?80:120;
    return 0;
  }
  return Object.freeze({VERSION,MODES,normalizeMode,countLabel,groupPoints,declutter,routeStyle,busiestRoutes,budget});
});
