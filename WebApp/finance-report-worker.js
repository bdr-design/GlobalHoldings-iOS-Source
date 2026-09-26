'use strict';

importScripts('finance-report-core.js');
self.addEventListener('message',event=>{
  const message=event?.data||{};
  try{
    if(message.type!=='aggregate'||!Number.isSafeInteger(message.requestId)||!Number.isSafeInteger(message.generation)||typeof message.key!=='string')throw new Error('finance-report-request-invalid');
    const months=self.GH_FINANCE_REPORT_CORE.buildMonthlyStatement(message.snapshot);
    self.postMessage({type:'result',requestId:message.requestId,generation:message.generation,key:message.key,version:self.GH_FINANCE_REPORT_CORE.VERSION,months});
  }catch(error){self.postMessage({type:'error',requestId:message.requestId||0,generation:message.generation||0,error:String(error?.message||error)});}
});
