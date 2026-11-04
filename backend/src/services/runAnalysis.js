import {fork} from 'node:child_process';
export function runAnalysis(input,{timeoutMs=120000}={}){
 return new Promise(resolve=>{
  // PDF's native canvas dependency can crash when unloaded from a Windows worker
  // thread. A bounded child process keeps native teardown out of the API process.
  const worker=fork(new URL('./analysisWorker.js',import.meta.url),[],{serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],execArgv:['--max-old-space-size=256']});
  let settled=false;
  const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);worker.kill();resolve(result);};
  const failure=message=>({status:'Failed',errorMessage:message,summary:{requires_manual_verification:1},entries:[]});
  const timer=setTimeout(()=>finish(failure('Processing timed out. Please review the document manually.')),timeoutMs);
  worker.once('message',finish);worker.once('error',()=>finish(failure('Document processing failed. Please review manually.')));
  worker.once('exit',code=>{if(!settled)finish(failure('Document processing stopped before completion.'));});
  worker.send(input,error=>{if(error)finish(failure('Document processing could not start.'));});
 });
}
