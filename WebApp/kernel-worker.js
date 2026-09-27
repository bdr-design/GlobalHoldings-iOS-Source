importScripts('kernel-core.js','kernel-worker-core.js');
const host=globalThis.GH_KERNEL_WORKER.createHost(globalThis.GH_KERNEL);
self.addEventListener('message',event=>{
  const result=host.handle(event.data);
  if(result.transfer.length)self.postMessage(result.message,result.transfer);
  else self.postMessage(result.message);
});
