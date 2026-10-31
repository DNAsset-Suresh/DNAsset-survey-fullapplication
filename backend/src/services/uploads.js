import { randomUUID } from 'node:crypto';
import { validateFile, fail } from '../validators.js';
import { unwrap } from './database.js';

export async function persistUpload({admin,config,actor,document,file,replaceId=null}) {
  const valid=await validateFile(file,config.maxFileBytes);
  const storagePath=`${document.property_id}/${document.id}/${randomUUID()}${valid.ext}`;
  const storage=admin.storage.from(config.bucket);
  const uploaded=await storage.upload(storagePath,file.buffer,{contentType:valid.mime,upsert:false,cacheControl:'0'});
  if(uploaded.error) throw fail(502,'Upload failed. No file record was saved.');
  const metadata={original_file_name:valid.name,storage_path:storagePath,mime_type:valid.mime,file_size:file.size};
  try {
    const id=unwrap(await admin.rpc('commit_file',{p_actor:actor,p_document:document.id,p_file:metadata,p_replace:replaceId}));
    return {id,...metadata};
  } catch(error) {
    // An ambiguous network response may follow a successful commit. Resolve before deleting the object.
    const check=await admin.from('uploaded_files').select('id').eq('storage_path',storagePath).maybeSingle();
    if(!check.error && check.data) return {id:check.data.id,...metadata};
    if(!check.error) {
      const removal=await storage.remove([storagePath]);
      if(removal.error) await admin.from('storage_cleanup').upsert({storage_path:storagePath});
    }
    // If the database is unreachable, preserve the object for reconciliation rather than deleting a possibly committed file.
    throw error;
  }
}
