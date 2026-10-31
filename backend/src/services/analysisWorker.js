import {analyzeDocument} from './analyzer.js';
process.once('message',async input=>{
 let result;
 try {result=await analyzeDocument({...input,buffer:Buffer.from(input.buffer)});}
 catch {result={status:'Failed',errorMessage:'Document processing failed. Review the source manually.',summary:{},entries:[]};}
 process.send(result,()=>process.exit(0));
});
