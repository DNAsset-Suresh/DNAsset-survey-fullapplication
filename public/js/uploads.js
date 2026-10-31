import { api } from './api.js';
import { toast } from './ui.js';
export async function uploadFiles(files,documentId,propertyId,maxBytes,refresh,replaceId=null){
 if(!files.length)return;
 const acceptedExtensions=['pdf','jpg','jpeg','png','xlsx','xls','csv'];
 for(const file of files){
   const ext=file.name.split('.').pop().toLowerCase();
   if(!acceptedExtensions.includes(ext))throw new Error('Choose PDF, Excel (.xlsx, .xls), CSV, JPG, or PNG files.');
   if(!file.size||file.size>maxBytes)throw new Error(`Each file must be between 1 byte and ${maxBytes/1048576} MB.`);
 }
 let done=0;
 try {for(const file of files){toast(`Uploading ${done+1} of ${files.length}: ${file.name}`);const body=new FormData();body.append('file',file);if(replaceId)body.append('replace_id',replaceId);await api(`/properties/${propertyId}/documents/${documentId}/files`,{method:'POST',body});done++;}toast(`${done} file${done===1?'':'s'} uploaded. Mark the category collected when ready.`);}
 catch(error){throw new Error(`${done} of ${files.length} files saved. ${error.message}`);}finally{await refresh();}
}
export async function openFile(id,download=false){
 const win=download?null:window.open('about:blank','_blank');if(win)win.opener=null;
 try{const {url}=await api(`/files/${id}/url${download?'?download=1':''}`);if(win)win.location.href=url;else{const a=document.createElement('a');a.href=url;a.rel='noopener';a.target='_blank';a.click();}}
 catch(error){win?.close();throw error;}
}
