(()=>{
  'use strict';

  const VERSION='3.0.0';
  const HOUR_SECONDS=3600;
  const DAY_SECONDS=86400;
  const BOUNDARY_EPSILON=1e-8;
  const MIN_SLICE_SECONDS=1e-6;

  function finiteNonNegative(value){
    const n=Number(value);
    return Number.isFinite(n)?Math.max(0,n):0;
  }
  function boundaryAt(simSeconds){
    const to=finiteNonNegative(simSeconds),hour=to/HOUR_SECONDS,day=to/DAY_SECONDS;
    const roundedHour=Math.round(hour),roundedDay=Math.round(day);
    return {
      hour:Math.abs(hour-roundedHour)<BOUNDARY_EPSILON?roundedHour:null,
      day:Math.abs(day-roundedDay)<BOUNDARY_EPSILON?roundedDay:null
    };
  }
  function nextBoundaryAfter(simSeconds){
    const from=finiteNonNegative(simSeconds);
    const nextHour=(Math.floor(from/HOUR_SECONDS)+1)*HOUR_SECONDS;
    const nextDay=(Math.floor(from/DAY_SECONDS)+1)*DAY_SECONDS;
    return {hour:nextHour,day:nextDay,next:Math.min(nextHour,nextDay)};
  }
  function clampSliceToBoundary(simSeconds,maxSliceSeconds){
    const from=finiteNonNegative(simSeconds),requested=Number(maxSliceSeconds);
    if(!Number.isFinite(requested)||requested<=0)return MIN_SLICE_SECONDS;
    const boundary=nextBoundaryAfter(from);
    return Math.max(MIN_SLICE_SECONDS,Math.min(requested,boundary.hour-from,boundary.day-from));
  }
  function planSlice(simSeconds,maxSliceSeconds){
    const from=finiteNonNegative(simSeconds),sliceSeconds=clampSliceToBoundary(from,maxSliceSeconds),to=from+sliceSeconds;
    return {from,to,sliceSeconds,boundary:boundaryAt(to)};
  }
  function boundaryOrder(boundary={}){
    const order=[];
    if(boundary.day!==null&&boundary.day!==undefined)order.push('day');
    if(boundary.hour!==null&&boundary.hour!==undefined)order.push('hour');
    return order;
  }

  const API=Object.freeze({VERSION,HOUR_SECONDS,DAY_SECONDS,BOUNDARY_EPSILON,MIN_SLICE_SECONDS,boundaryAt,nextBoundaryAfter,clampSliceToBoundary,planSlice,boundaryOrder});
  globalThis.GH_SIMULATION_TIME_CORE=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_SIMULATION_TIME_CORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
