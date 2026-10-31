import { createClient } from '@supabase/supabase-js';
import { fail } from '../validators.js';

export const clientOptions = {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
export function clients(config) {
  if (!config.configured || !config.url) return {};
  return {
    admin:createClient(config.url,config.secretKey,clientOptions),
    anonymous:() => createClient(config.url,config.publishableKey,clientOptions),
    user:token => createClient(config.url,config.publishableKey,{...clientOptions,global:{headers:{Authorization:`Bearer ${token}`}}})
  };
}
export function unwrap({data,error}) {
  if(error) {
    if(error.code==='42501') throw fail(403,'You do not have permission for this action.');
    if(error.code==='40001') throw fail(409,'Data changed. Preview the operation again.');
    if(error.code==='23505') throw fail(409,'That property identity or file already exists.');
    if(['P0002','PGRST116'].includes(error.code)) throw fail(404,'Record not found or access denied.');
    if(['22023','23514','23502','22P02'].includes(error.code)) throw fail(400,'The change violates a document or property rule. Check the supplied values.');
    console.error('Database operation failed:',error.code || 'unknown');
    throw fail(502,'The database operation could not be completed.');
  }
  return data;
}
export async function allRows(makeQuery) {
  const result=[];
  for(let start=0;;start+=500) {
    const rows=unwrap(await makeQuery().range(start,start+499)); result.push(...rows);
    if(rows.length<500) return result;
  }
}
export async function projectAccess(db,id) {
  const row=unwrap(await db.from('projects').select('*').eq('id',id).maybeSingle());
  if(!row) throw fail(404,'Project not found or access denied.'); return row;
}
export async function propertyAccess(db,id) {
  const row=unwrap(await db.from('properties').select('*').eq('id',id).maybeSingle());
  if(!row) throw fail(404,'Property not found or access denied.'); return row;
}
export async function documentAccess(db,id,propertyId) {
  const row=unwrap(await db.from('property_documents').select('*').eq('id',id).maybeSingle());
  if(!row || (propertyId && row.property_id!==propertyId)) throw fail(404,'Document not found or access denied.'); return row;
}
export async function fileAccess(db,id) {
  const row=unwrap(await db.from('uploaded_files').select('*').eq('id',id).maybeSingle());
  if(!row) throw fail(404,'File not found or access denied.'); return row;
}
export async function checklist(db,propertyId) {
  const property=await propertyAccess(db,propertyId);
  const documents=unwrap(await db.from('property_documents').select('*, category:document_categories(*), reviewer:profiles!reviewer_id(full_name)').eq('property_id',propertyId));
  const ids=documents.map(d=>d.id);
  const files=ids.length ? await allRows(()=>db.from('uploaded_files').select('*, uploader:profiles!uploaded_by(full_name)').in('property_document_id',ids).order('uploaded_at').order('id')) : [];
  for(const doc of documents) doc.files=files.filter(f=>f.property_document_id===doc.id);
  documents.sort((a,b)=>(a.category?.display_order ?? 999)-(b.category?.display_order ?? 999));
  const progressRes = await db.from('property_progress').select('*').eq('property_id',propertyId).maybeSingle();
  const progress = progressRes?.data || {
    property_id: propertyId,
    required: documents.length || 7,
    collected: documents.filter(d => d.is_collected && d.files?.length).length,
    pending: Math.max(0, (documents.length || 7) - documents.filter(d => d.is_collected && d.files?.length).length),
    verified: documents.filter(d => d.verification_status === 'Verified').length,
    rejected: documents.filter(d => d.verification_status === 'Rejected').length,
    under_review: documents.filter(d => d.verification_status === 'Under Review').length,
    collection_percentage: documents.length ? +(documents.filter(d => d.is_collected && d.files?.length).length / documents.length * 100).toFixed(2) : 0,
    verification_percentage: documents.length ? +(documents.filter(d => d.verification_status === 'Verified').length / documents.length * 100).toFixed(2) : 0
  };
  return {property,documents,progress};
}
export async function checklistsForProperties(db,properties) {
  if(!properties.length)return [];
  const ids=properties.map(p=>p.id);
  const documents=await allRows(()=>db.from('property_documents').select('*, category:document_categories(*), reviewer:profiles!reviewer_id(full_name)').in('property_id',ids).order('id'));
  const [files,progress]=await Promise.all([
    documents.length?allRows(()=>db.from('uploaded_files').select('*, uploader:profiles!uploaded_by(full_name)').in('property_document_id',documents.map(d=>d.id)).order('id')):[],
    allRows(()=>db.from('property_progress').select('*').in('property_id',ids).order('property_id'))
  ]);
  const fileMap=new Map(),documentMap=new Map(),progressMap=new Map(progress.map(p=>[p.property_id,p]));
  for(const f of files){if(!fileMap.has(f.property_document_id))fileMap.set(f.property_document_id,[]);fileMap.get(f.property_document_id).push(f);}
  for(const d of documents){d.files=fileMap.get(d.id)||[];if(!documentMap.has(d.property_id))documentMap.set(d.property_id,[]);documentMap.get(d.property_id).push(d);}
  return properties.map(property=>{
    const pDocs = (documentMap.get(property.id)||[]).sort((a,b)=>(a.category?.display_order ?? 999)-(b.category?.display_order ?? 999));
    const pProg = progressMap.get(property.id) || {
      property_id: property.id,
      required: pDocs.length || 7,
      collected: pDocs.filter(d => d.is_collected && d.files?.length).length,
      pending: Math.max(0, (pDocs.length || 7) - pDocs.filter(d => d.is_collected && d.files?.length).length),
      verified: pDocs.filter(d => d.verification_status === 'Verified').length,
      rejected: pDocs.filter(d => d.verification_status === 'Rejected').length,
      under_review: pDocs.filter(d => d.verification_status === 'Under Review').length,
      collection_percentage: pDocs.length ? +(pDocs.filter(d => d.is_collected && d.files?.length).length / pDocs.length * 100).toFixed(2) : 0,
      verification_percentage: pDocs.length ? +(pDocs.filter(d => d.verification_status === 'Verified').length / pDocs.length * 100).toFixed(2) : 0
    };
    return {property,documents:pDocs,progress:pProg};
  });
}
export async function cleanupStorage(admin,bucket) {
  const {data,error}=await admin.from('storage_cleanup').select('storage_path').order('created_at').limit(50);
  if(error) return;
  for(const {storage_path} of data) {
    const removed=await admin.storage.from(bucket).remove([storage_path]);
    if(!removed.error) await admin.from('storage_cleanup').delete().eq('storage_path',storage_path);
  }
}
