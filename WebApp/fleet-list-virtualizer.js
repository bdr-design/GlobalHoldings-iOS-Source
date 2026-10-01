(()=>{'use strict';
  function create(count,{estimate=280,overscan=6,heights=null}={}){
    count=Math.max(0,Math.floor(Number(count)||0));estimate=Math.max(1,Number(estimate)||280);overscan=Math.max(0,Math.floor(Number(overscan)||0));
    const tree=new Float64Array(count+1),values=new Float64Array(count);values.fill(estimate);
    for(let i=1;i<=count;i++)tree[i]=(i&-i)*estimate;
    const total=()=>prefix(count);
    function prefix(end){let sum=0;for(let i=Math.max(0,Math.min(count,Math.floor(Number(end)||0)));i>0;i-=i&-i)sum+=tree[i];return sum;}
    function measure(index,height){index=Math.floor(Number(index));height=Number(height);if(index<0||index>=count||!Number.isFinite(height)||height<=0)return 0;const next=Math.max(1,height),delta=next-values[index];if(Math.abs(delta)<.5)return 0;values[index]=next;for(let i=index+1;i<=count;i+=i&-i)tree[i]+=delta;return delta;}
    function lowerBound(offset){let target=Math.max(0,Number(offset)||0),index=0,sum=0,step=1;while((step<<1)<=count)step<<=1;for(;step;step>>=1){const next=index+step;if(next<=count&&sum+tree[next]<=target){index=next;sum+=tree[next];}}return Math.min(index,count);}
    function range(scrollTop,viewportHeight){if(!count)return {start:0,end:0,top:0,bottom:0,total:0};const top=Math.max(0,Number(scrollTop)||0),height=Math.max(0,Number(viewportHeight)||0),start=Math.max(0,lowerBound(top)-overscan),end=Math.min(count,lowerBound(top+height)+overscan+1),all=total();return {start,end,top:prefix(start),bottom:Math.max(0,all-prefix(end)),total:all};}
    if(heights&&typeof heights.get==='function')for(let i=0;i<count;i++){const h=heights.get(i);if(Number.isFinite(Number(h))&&Number(h)>0)measure(i,Number(h));}
    return Object.freeze({count,estimate,measure,range,total,prefix,indexAt:lowerBound,heightAt:index=>values[index]});
  }
  const API=Object.freeze({create});globalThis.GH_FLEET_LIST_VIRTUALIZER=API;if(globalThis.window&&window!==globalThis)window.GH_FLEET_LIST_VIRTUALIZER=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
