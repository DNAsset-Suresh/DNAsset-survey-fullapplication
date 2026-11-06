import { z } from 'zod';
import { fileTypeFromBuffer } from 'file-type';
import path from 'node:path';

export const uuid = z.uuid();
const short = z.string().trim().max(160).default('');
export const projectSchema = z.object({
  project_name: z.string().trim().min(1, 'Project name is required').max(160),
  project_code: z.string().trim().max(50).default(''),
  description: z.string().trim().max(4000).default(''),
  promoter_name: short,
  village: short,
  taluk: short,
  district: short,
  project_address: z.string().trim().max(4000).default(''),
  total_land_extent: z.number().finite().min(0).max(999999999999).nullable().default(null),
  measurement_unit: z.enum(['acres','cents','hectares','sq ft','sq m']).default('acres'),
  status: z.enum(['Active','Completed','On Hold','Under Review','Draft']).default('Active'),
  remarks: z.string().trim().max(4000).default(''),
  access_password: z.string().trim().max(100).optional()
}).strict();

export const unlockProjectSchema = z.object({
  password: z.string().min(1, 'Password is required').max(100)
}).strict();

export const propertySchema = z.object({
  project_id: uuid.nullable().optional(),
  survey_number: z.string().trim().min(1).max(80),
  subdivision_number: z.string().trim().max(80).default(''),
  patta_number: z.string().trim().max(80).default(''),
  property_name: short,
  village: short,
  taluk: short,
  district: short,
  owner_name: short,
  land_extent: z.number().finite().min(0).max(999999999999).nullable().default(null),
  land_extent_unit: z.enum(['acres','cents','hectares','sq ft','sq m']).default('acres'),
  status: z.enum(['Active','Verified','Pending','Rejected','In Progress']).default('Active'),
  remarks: z.string().trim().max(4000).default('')
}).strict();
export const reviewSchema = z.object({
  verification_status: z.enum(['Pending','Under Review','Verified','Rejected']),
  survey_match_status: z.enum(['Not Checked','Matches Survey Number','Mismatch Found','Requires Manual Review']),
  remarks: z.string().trim().max(4000).default(''), rejection_reason: z.string().trim().max(4000).default('')
}).strict().superRefine((value,ctx) => {
  if(value.verification_status === 'Rejected' && !value.rejection_reason) ctx.addIssue({code:'custom',message:'A rejection reason is required.'});
  if(value.verification_status === 'Verified' && value.survey_match_status !== 'Matches Survey Number') ctx.addIssue({code:'custom',message:'Confirm the survey number match before verification.'});
});
export const collectionSchema = z.object({is_collected:z.boolean()}).strict();
export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').max(254),
  password: z.string().min(1, 'Password is required').max(1024),
  full_name: z.string().trim().max(160).optional(),
  user_name: z.string().trim().max(160).optional()
});
export const updateProfileSchema = z.object({
  full_name: z.string().trim().min(1, 'Name is required').max(160).optional(),
  password: z.string().min(4, 'Password must be at least 4 characters').max(1024).optional()
}).strict().refine(data => data.full_name !== undefined || data.password !== undefined, {
  message: 'Either name or password must be provided.'
});
export const adminUpdateUserSchema = z.object({
  full_name: z.string().trim().min(1, 'Name is required').max(160).optional(),
  password: z.string().min(4, 'Password must be at least 4 characters').max(1024).optional(),
  role: z.enum(['admin', 'reviewer']).optional()
}).strict().refine(data => data.full_name !== undefined || data.password !== undefined || data.role !== undefined, {
  message: 'Either name, password, or role must be provided.'
});

export const scheduleSchema = z.object({
  property_id: uuid.nullable().optional(),
  village: short,
  survey_number: z.string().trim().min(1, 'Survey number is required').max(80),
  subdivision_number: z.string().trim().max(80).default(''),
  total_extent: z.string().trim().max(160).default(''),
  total_extent_sqft: z.number().finite().min(0).nullable().optional(),
  extent_conveyed: z.string().trim().max(160).default(''),
  extent_conveyed_sqft: z.number().finite().min(0).nullable().optional(),
  patta_number: z.string().trim().max(100).default(''),
  root_parent_deed: z.string().trim().max(255).default(''),
  previous_doc_pr: z.string().trim().max(500).default(''),
  schedule_value: z.number().finite().min(0).nullable().optional(),
  verification_status: z.enum(['Verified', 'Mentioned in EC only', 'Not independently examined', 'Missing / To Confirm', 'Under Review']).default('Verified'),
  source_page: z.string().trim().max(160).default(''),
  remarks: z.string().trim().max(4000).default('')
}).strict();

export const prChainSchema = z.object({
  schedule_id: uuid.nullable().optional(),
  property_id: uuid.nullable().optional(),
  survey_number: z.string().trim().max(80).default(''),
  village: short,
  parent_root_doc: z.string().trim().max(255).default(''),
  previous_doc_number: z.string().trim().min(1, 'Previous document number is required').max(255),
  registration_year: z.string().trim().max(20).default(''),
  registration_date: z.string().trim().max(50).nullable().optional(),
  document_type: z.string().trim().max(120).default('Sale Deed'),
  ec_reference: z.string().trim().max(255).default(''),
  subdivisions: z.string().trim().max(255).default(''),
  acquisition_deed: z.string().trim().max(255).default(''),
  from_party: z.string().trim().max(255).default(''),
  to_party: z.string().trim().max(255).default(''),
  extent: z.string().trim().max(160).default(''),
  value: z.number().finite().min(0).nullable().optional(),
  verification_status: z.enum(['Verified', 'Unverified', 'Mentioned in EC only', 'Pending']).default('Verified'),
  notes: z.string().trim().max(4000).default(''),
  attachment_url: z.string().trim().max(1000).default(''),
  attachment_name: z.string().trim().max(255).default('')
}).strict();

export const acquisitionDeedSchema = z.object({
  document_number: z.string().trim().min(1, 'Document number is required').max(255),
  document_type: z.string().trim().max(120).default('Sale Deed'),
  registration_year: z.string().trim().max(20).default(''),
  registration_date: z.string().trim().max(50).nullable().optional(),
  sro: z.string().trim().max(160).default(''),
  seller: z.string().trim().max(255).default(''),
  purchaser: z.string().trim().max(255).default(''),
  previous_document: z.string().trim().max(255).default(''),
  survey_numbers: z.string().trim().max(500).default(''),
  extent: z.string().trim().max(160).default(''),
  extent_sqft: z.number().finite().min(0).nullable().optional(),
  value: z.number().finite().min(0).nullable().optional(),
  source: z.string().trim().max(255).default(''),
  status: z.string().trim().max(80).default('Verified'),
  remarks: z.string().trim().max(4000).default('')
}).strict();
export function fail(status, message) { return Object.assign(new Error(message), {status}); }
export async function validateFile(file, maxBytes) {
  if (!file) throw fail(400,'Choose a PDF, Excel, CSV, JPG, or PNG file.');
  if (!file.size || file.size > maxBytes) throw fail(413,'The file exceeds the configured size limit or is empty.');
  const ext = path.extname(file.originalname).toLowerCase();
  const standardMimes = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png'
  };
  const name = file.originalname.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g,'').slice(0,255);
  if (!name) throw fail(400,'Invalid filename.');

  if (standardMimes[ext]) {
    const mime = standardMimes[ext];
    let detected;
    try { detected = await fileTypeFromBuffer(file.buffer); } catch { /* Treat truncated headers as invalid. */ }
    if (file.mimetype !== mime || detected?.mime !== mime) {
      throw fail(400,'File extension, content, and MIME type must match PDF, JPG, or PNG.');
    }
    return {name, mime, ext};
  }

  if (ext === '.xlsx') {
    const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    let detected;
    try { detected = await fileTypeFromBuffer(file.buffer); } catch {}
    const isZip = detected?.mime === 'application/zip' || detected?.mime === mime;
    if (!isZip) throw fail(400, 'File extension, content, and MIME type must match XLSX.');
    return {name, mime, ext};
  }

  if (ext === '.xls') {
    const mime = 'application/vnd.ms-excel';
    let detected;
    try { detected = await fileTypeFromBuffer(file.buffer); } catch {}
    const isCfb = detected?.mime === 'application/x-cfb' || detected?.mime === mime;
    if (!isCfb) throw fail(400, 'File extension, content, and MIME type must match XLS.');
    return {name, mime, ext};
  }

  if (ext === '.csv') {
    const mime = 'text/csv';
    let detected;
    try { detected = await fileTypeFromBuffer(file.buffer); } catch {}
    // CSV is plain text, so detected should be undefined or text
    if (detected) throw fail(400, 'File extension, content, and MIME type must match CSV.');
    const textSample = file.buffer.slice(0, 1024).toString('utf8');
    if (textSample.includes('\x00') || /<script[\s>]/i.test(textSample)) {
      throw fail(400, 'File extension, content, and MIME type must match CSV.');
    }
    return {name, mime, ext};
  }

  throw fail(400,'File extension, content, and MIME type must match accepted formats (PDF, Excel, CSV, JPG, PNG).');
}
