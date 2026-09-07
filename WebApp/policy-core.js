(()=>{
  'use strict';
  const VERSION='2.9.0';
  function result(name,checks){const blocked=checks.filter(c=>!c.ok&&c.blocking!==false),warnings=checks.filter(c=>!c.ok&&c.blocking===false);return {policy:name,approved:blocked.length===0,blocked,warnings,checks,at:Date.now()};}
  function procurement(facts={}){return result('ProcurementPolicy',[
    {id:'catalog',ok:!!facts.item,blocking:true,message:'الأصل يجب أن يكون موجودًا في الكتالوج.'},
    {id:'base',ok:!!facts.base,blocking:true,message:'يجب وجود منشأة تسليم مملوكة ومتوافقة.'},
    {id:'qty',ok:Number(facts.qty)>0&&Number.isInteger(Number(facts.qty)),blocking:true,message:'الكمية يجب أن تكون عددًا صحيحًا موجبًا.'},
    {id:'study',ok:Number(facts.studyScore)>=60,blocking:true,message:'درجة دراسة AI أقل من الحد الوقائي 60/100.'},
    {id:'authority',ok:!!facts.authority,blocking:true,message:'لا يوجد تفويض صالح للطلب.'},
    {id:'capacity',ok:Number(facts.freeCapacity)>=Number(facts.qty),blocking:true,message:'السعة المتاحة أقل من الكمية المطلوبة.'},
    {id:'funding',ok:Number(facts.fundingGap)<=0,blocking:true,message:'توجد فجوة تمويل غير مغلقة.'}
  ]);}
  function closure(facts={}){return result('DemandClosurePolicy',[
    {id:'deliveries',ok:Number(facts.delivered)>=Number(facts.requested),blocking:true,message:'لم تصل كامل الكمية المطلوبة.'},
    {id:'dependencies',ok:Number(facts.openDependencies)===0,blocking:true,message:'توجد تبعيات مفتوحة.'},
    {id:'staffing',ok:Number(facts.staffingGap)<=0,blocking:true,message:'فجوة الجاهزية البشرية لم تغلق.'},
    {id:'integrity',ok:Number(facts.integrityCritical||0)===0,blocking:true,message:'توجد مشكلة سلامة حرجة مرتبطة بالطلب.'}
  ]);}
  function evaluate(name,facts){if(name==='procurement')return procurement(facts);if(name==='closure')return closure(facts);return result(name,[]);}
  const API=Object.freeze({VERSION,evaluate,procurement,closure});globalThis.GH_POLICY_CORE=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_POLICY_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
