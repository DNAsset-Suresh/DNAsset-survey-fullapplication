import { createFirebaseStorage } from './firebase.js';
import { requestFirebase, firebaseRequestMiddleware, firebaseAuthRequest, firebaseSession, normalizeLoginEmail } from './firebaseRequest.js';
import { initializeServerApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit as fsLimit,
  startAfter,
  writeBatch
} from 'firebase/firestore';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updatePassword,
  updateEmail,
  updateProfile
} from 'firebase/auth';
import { randomUUID } from 'node:crypto';

import { fail } from '../validators.js';


const signedDownloads = new Map();

export const DEFAULT_CATEGORIES = [
  {
    id: '671c3c57-5f93-401b-aa43-42097ec4f522',
    name: 'Title Documents',
    description: 'Registered deeds and the chain of title.',
    display_order: 1,
    is_active: true
  },
  {
    id: '6c8f7d26-9931-4d21-8d9c-a9e98c9dbe5a',
    name: 'Field Measurement Book (FMB)',
    description: 'Survey sketch and field measurements.',
    display_order: 2,
    is_active: true
  },
  {
    id: '57da0f1b-1649-4840-b3f0-9fdf4388f586',
    name: 'Patta',
    description: 'Revenue record for the property.',
    display_order: 3,
    is_active: true
  },
  {
    id: '144eede7-795f-4a6c-80b3-9a1ff423493f',
    name: 'Encumbrance Certificate (EC)',
    description: 'Recorded transactions and encumbrances.',
    display_order: 4,
    is_active: true
  },
  {
    id: 'e3e5f0d1-e221-4a72-8b35-71ee51171865',
    name: 'Adangal',
    description: 'Land use and cultivation record.',
    display_order: 5,
    is_active: true
  },
  {
    id: '9424b345-39c0-48b9-aa4c-42322f0a2dfe',
    name: 'Government Pleader Legal Opinion',
    description: 'Legal review by the appropriate qualified professional.',
    display_order: 6,
    is_active: true
  },
  {
    id: '0c3e9297-bcb8-4ccb-90c6-ec0af9e3e8d5',
    name: 'A-Register',
    description: 'Village land and revenue register.',
    display_order: 7,
    is_active: true
  }
];

/**
 * Creates a QueryBuilder over Firestore collection mirroring PostgREST / Supabase API:
 *   db.from(table).select(fields).eq(col, val).in(col, vals).order(col, opts).limit(n).range(from, to)
 */
function createFirestoreQuery(firestore, table, actorId = null) {
  let selectFields = '*';
  const filters = [];
  const orders = [];
  let limitCount = null;
  let offsetCount = null;
  let isDelete = false;
  let isUpdate = false;
  let updateValues = null;

  const builder = {
    select(fields) {
      selectFields = fields || '*';
      return builder;
    },
    update(values) {
      isUpdate = true;
      updateValues = values;
      return builder;
    },
    eq(col, val) {
      filters.push({ type: 'eq', col, val });
      return builder;
    },
    in(col, vals) {
      filters.push({ type: 'in', col, val: vals });
      return builder;
    },
    order(col, options = {}) {
      orders.push({ col, ascending: options.ascending !== false });
      return builder;
    },
    limit(count) {
      limitCount = count;
      return builder;
    },
    range(from, to) {
      offsetCount = from;
      limitCount = (to - from) + 1;
      return builder;
    },
    async insert(rows) {
      try {
        const items = Array.isArray(rows) ? rows : [rows];
        const inserted = [];
        for (const item of items) {
          const id = item.id || randomUUID();
          const record = {
            ...item,
            id,
            created_at: item.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          const docRef = doc(firestore, table, id);
          await setDoc(docRef, record);
          inserted.push(record);
        }
        return { data: Array.isArray(rows) ? inserted : (inserted[0] || null), error: null };
      } catch (err) {
        return { data: null, error: { code: '500', message: err.message } };
      }
    },
    async upsert(row) {
      try {
        if (!row.id) {
          return { data: null, error: null };
        }
        const docRef = doc(firestore, table, row.id);
        await setDoc(docRef, { ...row, updated_at: new Date().toISOString() }, { merge: true });
        return { data: row, error: null };
      } catch (err) {
        return { data: null, error: { code: '500', message: err.message } };
      }
    },
    delete() {
      isDelete = true;
      return builder;
    },
    async then(resolve) {
      try {
        const res = await builder.execute();
        resolve(res);
      } catch (err) {
        resolve({ data: null, error: { code: '500', message: err.message } });
      }
    },
    async single() {
      builder.limit(1);
      const res = await builder.execute();
      if (res.error) return res;
      if (!res.data || res.data.length === 0) {
        return { data: null, error: { code: 'PGRST116', message: 'Record not found' } };
      }
      return { data: res.data[0], error: null };
    },
    async maybeSingle() {
      builder.limit(1);
      const res = await builder.execute();
      if (res.error) return res;
      return { data: res.data && res.data.length ? res.data[0] : null, error: null };
    },
    async execute() {
      try {
        // Special Virtual View: property_progress
        if (table === 'property_progress') {
          return await computePropertyProgress(firestore, filters, orders, offsetCount, limitCount);
        }
        // Special Virtual View: project_progress
        if (table === 'project_progress') {
          return await computeProjectProgress(firestore, filters, orders, offsetCount, limitCount);
        }

        const colRef = collection(firestore, table);
        const snap = await getDocs(colRef);
        let docs = snap.docs.map(d => ({ ...d.data(), id: d.id }));

        // Fallback for document_categories if empty
        if (table === 'document_categories' && docs.length === 0) {
          docs = DEFAULT_CATEGORIES.map(c => ({ ...c }));
        }

        // Apply filters in memory for full PostgREST compatibility
        for (const f of filters) {
          if (f.type === 'eq') {
            docs = docs.filter(d => d[f.col] === f.val);
          } else if (f.type === 'in') {
            const set = new Set(f.val || []);
            docs = docs.filter(d => set.has(d[f.col]));
          }
        }

        // Handle DELETE
        if (isDelete) {
          for (const d of docs) {
            await deleteDoc(doc(firestore, table, d.id));
          }
          return { data: null, error: null };
        }

        // Handle UPDATE
        if (isUpdate) {
          for (const d of docs) {
            await setDoc(doc(firestore, table, d.id), {
              ...updateValues,
              updated_at: new Date().toISOString()
            }, { merge: true });
          }
          return { data: null, error: null };
        }

        // Apply JOINs
        if (table === 'property_documents' && selectFields.includes('category:document_categories')) {
          const catsSnap = await getDocs(collection(firestore, 'document_categories'));
          const catMap = new Map(DEFAULT_CATEGORIES.map(c => [c.id, c]));
          catsSnap.docs.forEach(cd => catMap.set(cd.id, { ...cd.data(), id: cd.id }));
          const profSnap = await getDocs(collection(firestore, 'profiles'));
          const profMap = new Map(profSnap.docs.map(pd => [pd.id, pd.data()]));

          docs = docs.map(d => {
            const cat = catMap.get(d.document_category_id) || DEFAULT_CATEGORIES.find(c => c.name === d.document_name) || DEFAULT_CATEGORIES[0];
            return {
              ...d,
              category: cat,
              reviewer: d.reviewer_id && profMap.has(d.reviewer_id)
                ? { full_name: profMap.get(d.reviewer_id).full_name }
                : null
            };
          });
        }

        if (table === 'uploaded_files' && selectFields.includes('uploader:profiles')) {
          const profSnap = await getDocs(collection(firestore, 'profiles'));
          const profMap = new Map(profSnap.docs.map(pd => [pd.id, pd.data()]));
          docs = docs.map(f => ({
            ...f,
            uploader: f.uploaded_by && profMap.has(f.uploaded_by)
              ? { full_name: profMap.get(f.uploaded_by).full_name }
              : null
          }));
        }

        if (table === 'audit_logs' && selectFields.includes('actor:profiles')) {
          const profSnap = await getDocs(collection(firestore, 'profiles'));
          const profMap = new Map(profSnap.docs.map(pd => [pd.id, pd.data()]));
          docs = docs.map(a => ({
            ...a,
            actor: a.actor_id && profMap.has(a.actor_id)
              ? { full_name: profMap.get(a.actor_id).full_name }
              : null
          }));
        }

        if (table === 'property_members' && selectFields.includes('profile:profiles')) {
          const profSnap = await getDocs(collection(firestore, 'profiles'));
          const profMap = new Map(profSnap.docs.map(pd => [pd.id, pd.data()]));
          docs = docs.map(m => ({
            ...m,
            profile: m.user_id && profMap.has(m.user_id)
              ? { full_name: profMap.get(m.user_id).full_name, role: profMap.get(m.user_id).role }
              : null
          }));
        }

        // Apply sorting
        if (orders.length) {
          docs.sort((a, b) => {
            for (const o of orders) {
              const va = a[o.col] ?? '';
              const vb = b[o.col] ?? '';
              if (va < vb) return o.ascending ? -1 : 1;
              if (va > vb) return o.ascending ? 1 : -1;
            }
            return 0;
          });
        }

        // Apply pagination
        if (offsetCount !== null) {
          docs = docs.slice(offsetCount);
        }
        if (limitCount !== null) {
          docs = docs.slice(0, limitCount);
        }

        return { data: docs, error: null };
      } catch (err) {
        return { data: null, error: { code: '500', message: err.message } };
      }
    }
  };

  return builder;
}

// Compute property_progress view dynamically
async function computePropertyProgress(firestore, filters, orders = [], offsetCount = null, limitCount = null) {
  try {
    const propsSnap = await getDocs(collection(firestore, 'properties'));
    const docsSnap = await getDocs(collection(firestore, 'property_documents'));
    const filesSnap = await getDocs(collection(firestore, 'uploaded_files'));

    const fileDocIds = new Set(filesSnap.docs.map(f => f.data().property_document_id));
    const docsByProp = new Map();

    for (const d of docsSnap.docs) {
      const data = d.data();
      if (!docsByProp.has(data.property_id)) docsByProp.set(data.property_id, []);
      docsByProp.get(data.property_id).push({ ...data, id: d.id, hasFile: fileDocIds.has(d.id) });
    }

    let progress = propsSnap.docs.map(p => {
      const propId = p.id;
      const docs = docsByProp.get(propId) || [];
      const required = docs.length;
      const collected = docs.filter(d => d.is_collected && d.hasFile).length;
      const pending = required - collected;
      const verified = docs.filter(d => d.verification_status === 'Verified').length;
      const rejected = docs.filter(d => d.verification_status === 'Rejected').length;
      const under_review = docs.filter(d => d.verification_status === 'Under Review').length;
      const collection_percentage = required ? +(collected / required * 100).toFixed(2) : 0;
      const verification_percentage = required ? +(verified / required * 100).toFixed(2) : 0;

      return {
        property_id: propId,
        required,
        collected,
        pending,
        verified,
        rejected,
        under_review,
        collection_percentage,
        verification_percentage
      };
    });

    for (const f of filters) {
      if (f.type === 'eq') progress = progress.filter(p => p[f.col] === f.val);
      else if (f.type === 'in') {
        const set = new Set(f.val || []);
        progress = progress.filter(p => set.has(p[f.col]));
      }
    }

    if (orders && orders.length) {
      progress.sort((a, b) => {
        for (const o of orders) {
          const va = a[o.col] ?? '';
          const vb = b[o.col] ?? '';
          if (va < vb) return o.ascending ? -1 : 1;
          if (va > vb) return o.ascending ? 1 : -1;
        }
        return 0;
      });
    }

    if (offsetCount !== null && offsetCount !== undefined) {
      progress = progress.slice(offsetCount);
    }
    if (limitCount !== null && limitCount !== undefined) {
      progress = progress.slice(0, limitCount);
    }

    return { data: progress, error: null };
  } catch (err) {
    return { data: null, error: { code: '500', message: err.message } };
  }
}

// Compute project_progress view dynamically
async function computeProjectProgress(firestore, filters, orders = [], offsetCount = null, limitCount = null) {
  try {
    const projectsSnap = await getDocs(collection(firestore, 'projects'));
    const propsSnap = await getDocs(collection(firestore, 'properties'));
    const docsSnap = await getDocs(collection(firestore, 'property_documents'));
    const filesSnap = await getDocs(collection(firestore, 'uploaded_files'));

    const fileDocIds = new Set(filesSnap.docs.map(f => f.data().property_document_id));
    const propsByProject = new Map();
    for (const p of propsSnap.docs) {
      const data = p.data();
      if (data.project_id) {
        if (!propsByProject.has(data.project_id)) propsByProject.set(data.project_id, []);
        propsByProject.get(data.project_id).push(p.id);
      }
    }

    const docsByProp = new Map();
    for (const d of docsSnap.docs) {
      const data = d.data();
      if (!docsByProp.has(data.property_id)) docsByProp.set(data.property_id, []);
      docsByProp.get(data.property_id).push({ ...data, hasFile: fileDocIds.has(d.id) });
    }

    let progress = projectsSnap.docs.map(pr => {
      const projId = pr.id;
      const prData = pr.data();
      const propIds = propsByProject.get(projId) || [];
      const survey_count = propIds.length;
      let allDocs = [];
      for (const pid of propIds) {
        allDocs = allDocs.concat(docsByProp.get(pid) || []);
      }
      const required = allDocs.length;
      const collected = allDocs.filter(d => d.is_collected && d.hasFile).length;
      const pending = required - collected;
      const verified = allDocs.filter(d => d.verification_status === 'Verified').length;
      const rejected = allDocs.filter(d => d.verification_status === 'Rejected').length;
      const under_review = allDocs.filter(d => d.verification_status === 'Under Review').length;
      const collection_percentage = required ? +(collected / required * 100).toFixed(2) : 0;
      const verification_percentage = required ? +(verified / required * 100).toFixed(2) : 0;

      return {
        project_id: projId,
        project_name: prData.project_name || '',
        project_code: prData.project_code || '',
        survey_count,
        required,
        collected,
        pending,
        verified,
        rejected,
        under_review,
        collection_percentage,
        verification_percentage
      };
    });

    for (const f of filters) {
      if (f.type === 'eq') progress = progress.filter(p => p[f.col] === f.val);
      else if (f.type === 'in') {
        const set = new Set(f.val || []);
        progress = progress.filter(p => set.has(p[f.col]));
      }
    }

    if (orders && orders.length) {
      progress.sort((a, b) => {
        for (const o of orders) {
          const va = a[o.col] ?? '';
          const vb = b[o.col] ?? '';
          if (va < vb) return o.ascending ? -1 : 1;
          if (va > vb) return o.ascending ? 1 : -1;
        }
        return 0;
      });
    }

    if (offsetCount !== null && offsetCount !== undefined) {
      progress = progress.slice(offsetCount);
    }
    if (limitCount !== null && limitCount !== undefined) {
      progress = progress.slice(0, limitCount);
    }

    return { data: progress, error: null };
  } catch (err) {
    return { data: null, error: { code: '500', message: err.message } };
  }
}

/**
 * Initializes and returns Firebase database & auth client wrappers matching Supabase API
 */
export async function initFirebaseClients(config) {
  const firebaseStorageWrapper = createFirebaseStorage();

  async function rpc(name, args) {
    try {
      let opName = name;
      let opArgs = args;
      if (name === 'survey_run' && args?.p_operation) {
        opName = args.p_operation;
        opArgs = args.p_args || {};
      }

      if (opName === 'save_project') {
        const { p_actor, p_data, p_id = null } = opArgs;
        const id = p_id || randomUUID();
        const projectData = {
          ...p_data,
          id,
          created_by: p_actor,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        await setDoc(doc(requestFirebase().firestore, 'projects', id), projectData, { merge: true });
        // Add creator and reviewers to project_members
        await setDoc(doc(requestFirebase().firestore, 'project_members', `${id}_${p_actor}`), {
          project_id: id,
          user_id: p_actor
        }, { merge: true });

        const revSnap = await getDocs(query(collection(requestFirebase().firestore, 'profiles'), where('role', 'in', ['admin', 'reviewer'])));
        for (const rd of revSnap.docs) {
          await setDoc(doc(requestFirebase().firestore, 'project_members', `${id}_${rd.id}`), {
            project_id: id,
            user_id: rd.id
          }, { merge: true });
        }

        return { data: id, error: null };
      }

      if (opName === 'save_property') {
        const { p_actor, p_data, p_id = null } = opArgs;
        const id = p_id || randomUUID();
        const propertyData = {
          ...p_data,
          id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        await setDoc(doc(requestFirebase().firestore, 'properties', id), propertyData, { merge: true });

        // If new property, seed the 7 required checklist categories
        if (!p_id) {
          const catsSnap = await getDocs(collection(requestFirebase().firestore, 'document_categories'));
          let cats = catsSnap.docs.map(cd => ({ id: cd.id, ...cd.data() }));
          if (!cats.length) cats = DEFAULT_CATEGORIES;
          const batch = writeBatch(requestFirebase().firestore);
          for (const cd of cats) {
            const docId = randomUUID();
            const docRef = doc(requestFirebase().firestore, 'property_documents', docId);
            batch.set(docRef, {
              id: docId,
              property_id: id,
              document_category_id: cd.id,
              is_collected: false,
              verification_status: 'Pending',
              remarks: '',
              reviewer_id: null,
              reviewed_at: null,
              survey_match_status: 'Unmatched',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
          }
          await batch.commit();
        }

        return { data: id, error: null };
      }

      if (opName === 'update_document') {
        const { p_actor, p_document, p_data, p_review = false } = opArgs;
        const docRef = doc(requestFirebase().firestore, 'property_documents', p_document);
        const updatePayload = {
          ...p_data,
          updated_at: new Date().toISOString()
        };
        if (p_review) {
          updatePayload.reviewer_id = p_actor;
          updatePayload.reviewed_at = new Date().toISOString();
        }
        await setDoc(docRef, updatePayload, { merge: true });
        return { data: null, error: null };
      }

      if (opName === 'survey_history') {
        const filters = opArgs?.p_filters || {};
        const limitCount = Math.min(Number(filters.limit) || 25, 1000);
        const offsetCount = Number(filters.offset) || 0;
        const snap = await getDocs(collection(requestFirebase().firestore, 'upload_history'));
        let history = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        history.sort((a, b) => (b.upload_timestamp || '').localeCompare(a.upload_timestamp || ''));
        const total = history.length;
        history = history.slice(offsetCount, offsetCount + limitCount);
        return { data: { history, total }, error: null };
      }

      if (opName === 'survey_activity') {
        const filters = opArgs?.p_filters || {};
        const kind = filters.kind || 'reviews';
        const limitCount = Math.min(Number(filters.limit) || 50, 100);
        const offsetCount = Number(filters.offset) || 0;

        if (kind === 'audit') {
          const snap = await getDocs(collection(requestFirebase().firestore, 'audit_logs'));
          let rows = snap.docs.map(d => ({ ...d.data(), id: d.id }));
          rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
          rows = rows.slice(offsetCount, offsetCount + limitCount);
          return { data: { rows }, error: null };
        } else {
          const snap = await getDocs(collection(requestFirebase().firestore, 'document_reviews'));
          let rows = snap.docs.map(d => ({ ...d.data(), id: d.id }));
          rows.sort((a, b) => (b.reviewed_at || '').localeCompare(a.reviewed_at || ''));
          rows = rows.slice(offsetCount, offsetCount + limitCount);
          return { data: { rows }, error: null };
        }
      }

      if (opName === 'survey_delete_preview') {
        const p_scope = opArgs?.p_scope || 'project';
        const p_id = opArgs?.p_id || null;

        const projectsSnap = await getDocs(collection(requestFirebase().firestore, 'projects'));
        const propsSnap = await getDocs(collection(requestFirebase().firestore, 'properties'));
        const docsSnap = await getDocs(collection(requestFirebase().firestore, 'property_documents'));
        const filesSnap = await getDocs(collection(requestFirebase().firestore, 'uploaded_files'));
        const reviewsSnap = await getDocs(collection(requestFirebase().firestore, 'document_reviews'));
        const historySnap = await getDocs(collection(requestFirebase().firestore, 'upload_history'));

        const projects = projectsSnap.docs.map(d => ({ ...d.data(), id: d.id }));
        const props = propsSnap.docs.map(d => ({ ...d.data(), id: d.id }));
        const docs = docsSnap.docs.map(d => ({ ...d.data(), id: d.id }));
        const files = filesSnap.docs.map(d => ({ ...d.data(), id: d.id }));

        let prids = [];
        let pids = [];

        if (p_scope === 'all' || p_scope === 'reset') {
          prids = projects.map(p => p.id);
          pids = props.map(p => p.id);
        } else if (p_scope === 'project' && p_id) {
          prids = [p_id];
          pids = props.filter(p => p.project_id === p_id).map(p => p.id);
        } else if (p_scope === 'survey' && p_id) {
          pids = [p_id];
        }

        const pidsSet = new Set(pids);
        const matchingDocs = docs.filter(d => pidsSet.has(d.property_id));
        const didsSet = new Set(matchingDocs.map(d => d.id));
        const matchingFiles = files.filter(f => didsSet.has(f.property_document_id));

        const fileRecords = matchingFiles.map(f => ({
          storage_path: f.storage_path,
          file_size: Number(f.file_size) || 0
        }));

        const totalBytes = fileRecords.reduce((sum, f) => sum + f.file_size, 0);
        const fingerprint = `${prids.length}_${pids.length}_${matchingDocs.length}_${matchingFiles.length}`;

        return {
          data: {
            scope: p_scope,
            target_id: p_id,
            projects: prids.length,
            surveys: pids.length,
            checklists: matchingDocs.length,
            uploads: matchingFiles.length,
            verifications: p_scope === 'reset' ? reviewsSnap.docs.length : 0,
            history: p_scope === 'reset' ? historySnap.docs.length : 0,
            analyses: 0,
            extracted: 0,
            memberships: prids.length,
            project_ids: prids,
            property_ids: pids,
            files: fileRecords,
            storageObjects: fileRecords.length,
            storage_bytes: totalBytes,
            fingerprint,
            phrase: p_scope === 'reset' ? 'RESET SURVEY DATABASE' : 'DELETE ALL PROJECTS',
            backupEnabled: true,
            policy: p_scope === 'reset'
              ? 'Upload and review history will be removed. Audit records, users, accounts, settings and document categories remain.'
              : 'Upload and review history will be retained. Associated files will be removed. Users and audit records remain.'
          },
          error: null
        };
      }

      if (opName === 'survey_destroy') {
        const { p_scope, p_id } = opArgs;
        const projectsSnap = await getDocs(collection(requestFirebase().firestore, 'projects'));
        const propsSnap = await getDocs(collection(requestFirebase().firestore, 'properties'));
        const docsSnap = await getDocs(collection(requestFirebase().firestore, 'property_documents'));
        const filesSnap = await getDocs(collection(requestFirebase().firestore, 'uploaded_files'));

        const projects = projectsSnap.docs.map(d => ({ ...d.data(), id: d.id }));
        const props = propsSnap.docs.map(d => ({ ...d.data(), id: d.id }));
        const docs = docsSnap.docs.map(d => ({ ...d.data(), id: d.id }));
        const files = filesSnap.docs.map(d => ({ ...d.data(), id: d.id }));

        let prids = [];
        let pids = [];

        if (p_scope === 'all' || p_scope === 'reset') {
          prids = projects.map(p => p.id);
          pids = props.map(p => p.id);
        } else if (p_scope === 'project' && p_id) {
          prids = [p_id];
          pids = props.filter(p => p.project_id === p_id).map(p => p.id);
        } else if (p_scope === 'survey' && p_id) {
          pids = [p_id];
        }

        const pidsSet = new Set(pids);
        const matchingDocs = docs.filter(d => pidsSet.has(d.property_id));
        const didsSet = new Set(matchingDocs.map(d => d.id));
        const matchingFiles = files.filter(f => didsSet.has(f.property_document_id));

        for (const f of matchingFiles) {
          await deleteDoc(doc(requestFirebase().firestore, 'uploaded_files', f.id));
        }
        for (const d of matchingDocs) {
          await deleteDoc(doc(requestFirebase().firestore, 'property_documents', d.id));
        }
        for (const pid of pids) {
          await deleteDoc(doc(requestFirebase().firestore, 'properties', pid));
        }
        for (const prid of prids) {
          await deleteDoc(doc(requestFirebase().firestore, 'projects', prid));
        }

        if (p_scope === 'reset') {
          const revSnap = await getDocs(collection(requestFirebase().firestore, 'document_reviews'));
          for (const d of revSnap.docs) await deleteDoc(doc(requestFirebase().firestore, 'document_reviews', d.id));
          const histSnap = await getDocs(collection(requestFirebase().firestore, 'upload_history'));
          for (const d of histSnap.docs) await deleteDoc(doc(requestFirebase().firestore, 'upload_history', d.id));
        }

        return { data: { success: true }, error: null };
      }

      if (opName === 'survey_backup') {
        const collections = ['projects', 'properties', 'property_documents', 'uploaded_files', 'upload_history', 'document_reviews', 'storage_cleanup', 'property_members', 'project_members', 'document_categories'];
        const backupData = {};
        for (const col of collections) {
          const snap = await getDocs(collection(requestFirebase().firestore, col));
          backupData[col] = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        }
        return { data: backupData, error: null };
      }

      if (opName === 'survey_archive') {
        const { p_id, p_archived } = opArgs;
        const projectRef = doc(requestFirebase().firestore, 'projects', p_id);
        await updateDoc(projectRef, {
          archived_at: p_archived ? new Date().toISOString() : null,
          updated_at: new Date().toISOString()
        });
        return { data: { success: true }, error: null };
      }

      if (opName === 'manage_member') {
        const { p_property, p_user, p_remove } = opArgs;
        const memberRef = doc(requestFirebase().firestore, 'property_members', `${p_property}_${p_user}`);
        if (p_remove) {
          await deleteDoc(memberRef);
        } else {
          await setDoc(memberRef, {
            property_id: p_property,
            user_id: p_user,
            created_at: new Date().toISOString()
          }, { merge: true });
        }
        return { data: { success: true }, error: null };
      }

      if (opName === 'commit_file') {
        const { p_actor, p_document, p_file, p_replace = null } = opArgs;
        const fileId = randomUUID();
        const now = new Date().toISOString();
        const fileRecord = {
          id: fileId,
          property_document_id: p_document,
          original_file_name: p_file.original_file_name,
          storage_path: p_file.storage_path,
          mime_type: p_file.mime_type,
          file_size: Number(p_file.file_size) || 0,
          uploaded_by: p_actor,
          uploaded_at: now,
          created_at: now
        };
        await setDoc(doc(requestFirebase().firestore, 'uploaded_files', fileId), fileRecord);

        if (p_replace) {
          await deleteDoc(doc(requestFirebase().firestore, 'uploaded_files', p_replace));
        }

        const docRef = doc(requestFirebase().firestore, 'property_documents', p_document);
        await setDoc(docRef, {
          is_collected: true,
          verification_status: 'Uploaded',
          reviewer_id: null,
          survey_match_status: 'Not Checked',
          rejection_reason: '',
          updated_at: now
        }, { merge: true });

        // Audit log
        const auditId = randomUUID();
        await setDoc(doc(requestFirebase().firestore, 'audit_logs', auditId), {
          id: auditId,
          actor_id: p_actor,
          action: p_replace ? 'file.replaced' : 'file.uploaded',
          property_document_id: p_document,
          created_at: now
        });

        return { data: fileId, error: null };
      }

      if (opName === 'remove_file') {
        const { p_actor, p_file } = opArgs;
        const fileRef = doc(requestFirebase().firestore, 'uploaded_files', p_file);
        const fileSnap = await getDoc(fileRef);
        if (fileSnap.exists()) {
          const fileData = fileSnap.data();
          await deleteDoc(fileRef);
          if (fileData.property_document_id) {
            const otherFiles = await getDocs(query(collection(requestFirebase().firestore, 'uploaded_files'), where('property_document_id', '==', fileData.property_document_id)));
            if (otherFiles.empty) {
              await updateDoc(doc(requestFirebase().firestore, 'property_documents', fileData.property_document_id), {
                is_collected: false,
                verification_status: 'Pending',
                updated_at: new Date().toISOString()
              });
            }
          }
        }
        return { data: null, error: null };
      }

      return { data: null, error: null };
    } catch (err) {
      console.error(`[Firebase RPC] ${name} error:`, err);
      return { data: null, error: { message: err.message } };
    }
  }

  return {
    admin: {
      auth: {
        async getUser(token) {
          try {
            const context = requestFirebase();
            if (!token || context.token !== token) return { data: { user: null }, error: { message: 'Invalid session' } };
            await context.auth.authStateReady();
            const firebaseUser = context.auth.currentUser;
            if (!firebaseUser) return { data: { user: null }, error: { message: 'Session expired' } };
            const mapping = await getDoc(doc(context.firestore, 'users', firebaseUser.uid));
            const profileId = mapping.exists() ? mapping.data().id || firebaseUser.uid : firebaseUser.uid;
            const profile = await getDoc(doc(context.firestore, 'profiles', profileId));
            if (!profile.exists()) throw fail(403, 'Your sign-in is valid, but your workspace profile is missing. Contact an administrator.');
            context.actor = profileId;
            return { data: { user: { id: profileId, email: firebaseUser.email } }, error: null };
          } catch (error) {
            if (error.status === 403) throw error;
            throw fail(503, 'Your account could not be loaded. Check Firebase permissions and try again.');
          }
        },
        admin: {
          async signOut(token) {
            // Firebase ID tokens expire after one hour; the browser clears its session.
            return { error: null };
          },
          async updateUserById(id, { password, email, user_metadata = {} } = {}) {
            try {
              const updates = { updated_at: new Date().toISOString() };
              if (email) updates.email = email.toLowerCase().trim();
              if (user_metadata.full_name !== undefined) updates.full_name = user_metadata.full_name;

              const context = requestFirebase();
              if (password) {
                if (id !== context.actor) throw fail(501, 'Reset this account through Firebase Authentication. An administrator credential is required for server-side resets.');
                await firebaseAuthRequest(context.config, 'update', { idToken: context.token, password, returnSecureToken: false });
              }
              await updateDoc(doc(context.firestore, 'profiles', id), updates);
              return { data: { user: { id } }, error: null };
            } catch (err) {
              return { data: null, error: { message: err.message } };
            }
          },
          async listUsers() {
            try {
              const snap = await getDocs(collection(requestFirebase().firestore, 'profiles'));
              const users = snap.docs.map(d => d.data());
              return { data: { users }, error: null };
            } catch (err) {
              return { data: null, error: { message: err.message } };
            }
          }
        }
      },
      rpc,
      storage: firebaseStorageWrapper,
      from: table => createFirestoreQuery(requestFirebase().firestore, table, null)
    },
    anonymous: () => ({
      auth: {
        async signInWithPassword({ email, password }) {
          const result = await firebaseAuthRequest(config.firebase, 'signInWithPassword', { email: normalizeLoginEmail(email), password, returnSecureToken: true });
          const session = firebaseSession(result);
          // Check access before returning a session, so an incomplete profile is not
          // mistaken for a bad password or an unexplained return to the login screen.
          const signedApp = initializeServerApp(config.firebase, { authIdToken: session.access_token, releaseOnDeref: result });
          const auth = getAuth(signedApp); await auth.authStateReady();
          if (!auth.currentUser) throw fail(401, 'The sign-in session could not be verified. Please try again.');
          const db = getFirestore(signedApp);
          const mapping = await getDoc(doc(db, 'users', auth.currentUser.uid));
          const profileId = mapping.exists() ? mapping.data().id || auth.currentUser.uid : auth.currentUser.uid;
          const profile = await getDoc(doc(db, 'profiles', profileId));
          if (!profile.exists()) throw fail(403, 'Your workspace profile is missing. Contact an administrator.');
          return { data: { session }, error: null };
        },
        async refreshSession({ refresh_token }) {
          const result = await firebaseAuthRequest(config.firebase, 'refresh', { grant_type: 'refresh_token', refresh_token });
          return { data: { session: firebaseSession(result) }, error: null };
        }
      }
    }),
    user: token => ({
      from: table => createFirestoreQuery(requestFirebase().firestore, table, requestFirebase().actor)
    }),
    requestMiddleware: firebaseRequestMiddleware(config.firebase),
    flush: async () => {},
    signedDownloads
  };
}
