import {installSurveyManagement} from './services/surveyManagement.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes } from 'node:crypto';
import { configuration } from './config.js';
import { clients,unwrap,allRows,projectAccess,propertyAccess,documentAccess,fileAccess,checklist,checklistsForProperties,cleanupStorage } from './services/database.js';
import { persistUpload } from './services/uploads.js';
import { reportRows,csvReport,pdfReport } from './services/reports.js';
import { createMailer } from './services/mailer.js';
import { uploadProcessor } from './services/uploadProcessing.js';
import { checkPassword, hashPassword } from './services/localSecurity.js';
import * as XLSX from 'xlsx';
import { uuid,projectSchema,unlockProjectSchema,propertySchema,reviewSchema,collectionSchema,loginSchema,updateProfileSchema,adminUpdateUserSchema,fail } from './validators.js';

export function createApp(config=configuration(),providedClients) {
  const app=express();const dbs=providedClients || clients(config);const mailer=providedClients?.mailer || createMailer(config);
  const processor=dbs.admin ? uploadProcessor({admin:dbs.admin,config,mailer,flush:dbs.flush}) : null;
  app.locals.drainUploads=()=>processor?.drain();
  app.locals.recoverUploads=()=>processor?.recover();
  app.disable('x-powered-by'); if(config.trustProxy) app.set('trust proxy',config.trustProxy);
  app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],
    scriptSrc:["'self'","https://www.gstatic.com"],
    styleSrc:["'self'","'unsafe-inline'"],
    connectSrc:["'self'",...config.origins,"https://*.firebaseio.com","https://*.googleapis.com","https://*.google-analytics.com","https://*.firebasestorage.app"],
    imgSrc:["'self'",'data:',"https://*.google-analytics.com","https://*.googletagmanager.com"],
    objectSrc:["'none'"],frameAncestors:["'none'"],
    upgradeInsecureRequests:config.production?[]:null}},strictTransportSecurity:config.production?undefined:false}));
  app.use(cors({origin(origin,callback){callback(null,!origin || config.origins.includes(origin) || (typeof origin === 'string' && origin.endsWith('.vercel.app')));},methods:['GET','POST','PUT','DELETE'],allowedHeaders:['Authorization','Content-Type','X-Project-Password','X-Project-Unlock-Token']}));
  app.use('/api',rateLimit({windowMs:60000,limit:180,standardHeaders:'draft-8',legacyHeaders:false}));
  app.use(express.json({limit:'64kb'}));
  app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  app.get('/api',(_req,res)=>res.json({status:'ok',service:'DNAssets Survey API',configured:config.configured}));
  app.get('/api/config',(_req,res)=>res.json({configured:config.configured,maxFileBytes:config.maxFileBytes,isLocal:Boolean(config.isLocal),emailEnabled:Boolean(config.smtp?.enabled),adminEmail:config.smtp?.user||''}));
  app.get('/api/storage/download/:token',async(req,res,next)=>{
    const entry=dbs.signedDownloads?.get(req.params.token) || { storagePath: decodeURIComponent(req.params.token) };
    if(entry.expires && entry.expires < Date.now()) throw fail(404, 'Download link expired or is invalid.');
    const file=unwrap(await dbs.admin.from('uploaded_files').select('id,mime_type,original_file_name').eq('storage_path',entry.storagePath).maybeSingle());
    if(!file)throw fail(404,'File no longer exists.');
    res.attachment(entry.filename||file.original_file_name).type(file.mime_type);
    if(!entry.filename && ['application/pdf','image/png','image/jpeg'].includes(file.mime_type))res.set('Content-Disposition',res.get('Content-Disposition').replace(/^attachment/,'inline'));
    if (entry.path) {
      res.sendFile(entry.path,(error)=>{if(error&&!res.headersSent)next(fail(404,'Stored file is missing.'));});
    } else {
      const downloaded = await dbs.admin.storage.from(config.bucket).download(entry.storagePath);
      if (downloaded.error || !downloaded.data) throw fail(404, 'Stored file is missing.');
      const buffer = Buffer.from(await downloaded.data.arrayBuffer());
      res.send(buffer);
    }
  });
  const loginLimiter=rateLimit({windowMs:15*60000,limit:20,standardHeaders:'draft-8',legacyHeaders:false});
  const requireConfigured=(_req,_res,next)=>next(config.configured?undefined:fail(503,'Supabase is not configured. Follow the setup instructions in README.md.'));
  app.post('/api/auth/login',loginLimiter,requireConfigured,async(req,res)=>{
    const values=loginSchema.parse(req.body);
    const {data,error}=await dbs.anonymous().auth.signInWithPassword(values);
    if(error || !data.session) throw fail(401,'Email or password is incorrect.');
    res.json({access_token:data.session.access_token,refresh_token:data.session.refresh_token,expires_at:data.session.expires_at});
  });
  app.post('/api/auth/refresh',loginLimiter,requireConfigured,async(req,res)=>{
    const values=z.object({refresh_token:z.string().min(1).max(4096)}).strict().parse(req.body);
    const {data,error}=await dbs.anonymous().auth.refreshSession(values);
    if(error || !data.session) throw fail(401,'Session expired. Please sign in again.');
    res.json({access_token:data.session.access_token,refresh_token:data.session.refresh_token,expires_at:data.session.expires_at});
  });
  app.use('/api',requireConfigured,async(req,_res,next)=>{
    const token=req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if(!token) throw fail(401,'Sign in to continue.');
    const {data,error}=await dbs.admin.auth.getUser(token);
    if(error || !data.user) throw fail(401,'Session expired. Please sign in again.');
    req.token=token;req.actor=data.user.id;req.userEmail=data.user.email;req.db=dbs.user(token);
    req.profile=unwrap(await req.db.from('profiles').select('*').eq('id',req.actor).single());
    req.profile.email = req.userEmail;
    next();
  });
  const role=(...roles)=>(req,_res,next)=>next(roles.includes(req.profile.role)?undefined:fail(403,'Your role cannot perform this action.'));
  const writer=role('admin','collector','reviewer','user');
  const rpc=async(req,name,args)=>unwrap(await dbs.admin.rpc('survey_run',{p_actor:req.actor,p_operation:name,p_args:args,p_ip:req.ip}));
  app.get('/api/health',async(req,res)=>{unwrap(await req.db.from('document_categories').select('id').limit(1));res.json({status:'ok'});});
  app.get('/api/me',(req,res)=>res.json(req.profile));
  app.put('/api/me', async (req, res) => {
    const data = updateProfileSchema.parse(req.body);
    if (data.full_name !== undefined) {
      await dbs.admin.from('profiles').update({ full_name: data.full_name }).eq('id', req.actor);
    }
    if (data.password) {
      const authRes = await dbs.admin.auth.admin.updateUserById(req.actor, {
        password: data.password,
        user_metadata: { full_name: data.full_name || req.profile.full_name }
      });
      if (authRes?.error) {
        throw fail(500, authRes.error.message || 'Failed to update user password.');
      }
    }
    const updated = unwrap(await dbs.admin.from('profiles').select('*').eq('id', req.actor).single());
    res.json({ ...updated, email: req.userEmail });
  });

  app.get('/api/users', role('admin'), async (req, res) => {
    const usersRes = await dbs.admin.auth.admin.listUsers();
    if (usersRes?.data?.users) {
      return res.json(usersRes.data.users.map(({id,email,full_name,role,created_at})=>({id,email,full_name,role,created_at}))); 
    }
    const profiles = unwrap(await dbs.admin.from('profiles').select('*').order('created_at'));
    res.json(profiles);
  });

  app.put('/api/users/:id', role('admin'), async (req, res) => {
    const id = uuid.parse(req.params.id);
    const data = adminUpdateUserSchema.parse(req.body);
    const updateData = {};
    if (data.full_name !== undefined) updateData.full_name = data.full_name;
    if (data.role !== undefined) updateData.role = data.role;
    if (Object.keys(updateData).length > 0) {
      await dbs.admin.from('profiles').update(updateData).eq('id', id);
    }
    if (data.password || data.full_name !== undefined) {
      const authRes = await dbs.admin.auth.admin.updateUserById(id, {
        password: data.password,
        user_metadata: data.full_name !== undefined ? { full_name: data.full_name } : undefined
      });
      if (authRes?.error) {
        throw fail(500, authRes.error.message || 'Failed to update user password.');
      }
    }
    const updated = unwrap(await dbs.admin.from('profiles').select('*').eq('id', id).single());
    res.json(updated);
  });
  app.post('/api/auth/logout',async(req,res)=>{const {error}=await dbs.admin.auth.admin.signOut(req.token,'local');unlockedSessions.delete(req.token);if(error) throw fail(502,'Could not revoke the session. Please retry.');res.status(204).end();});

  const UNLOCK_SECRET = randomBytes(32);
  const unlockedSessions=new Map();
  function generateUnlockToken(userId, projectId) {
    return createHmac('sha256', UNLOCK_SECRET).update(`${userId}:${projectId}`).digest('hex');
  }

  async function verifyProjectAccess(req, project) {
    if (req.profile?.role === 'admin') return true;
    const accessPassword = (project.access_password || '').trim();
    if (!accessPassword) return true;

    const unlockToken = req.headers['x-project-unlock-token'];
    if (unlockToken && unlockToken === generateUnlockToken(req.actor, project.id)) return true;
    if(unlockedSessions.get(req.token)?.get(project.id)===accessPassword)return true;


    const providedPass = req.headers['x-project-password'];
    if (providedPass && await checkPassword(providedPass,accessPassword)) {
      return true;
    }

    const err = fail(403, 'This project is password-protected. Please enter the project access password to view.');
    err.code = 'PROJECT_PASSWORD_REQUIRED';
    err.projectId = project.id;
    throw err;
  }

  app.use('/api',async(req,_res,next)=>{
    let projectId=null;
    const resource=req.path.match(/^\/(projects|properties|survey-numbers|documents|files|analyses)\/([0-9a-f-]{36})(?:\/|$)/i);
    if(resource){
      const [,kind,id]=resource;
      if(kind==='projects')projectId=id;
      else {
        let propertyId=id;
        if(kind==='documents')propertyId=(await documentAccess(req.db,id)).property_id;
        if(kind==='files'||kind==='analyses'){const f=await fileAccess(req.db,id);propertyId=(await documentAccess(req.db,f.property_document_id)).property_id;}
        projectId=(await propertyAccess(req.db,propertyId)).project_id;
      }
    }
    if(projectId){const project=await projectAccess(req.db,projectId);req.project=project;if(project.archived_at&&req.method!=='GET')throw fail(409,'Archived projects are read-only.');if(!req.path.endsWith('/unlock'))await verifyProjectAccess(req,project);}
    if(req.body?.project_id){const project=await projectAccess(req.db,uuid.parse(req.body.project_id));await verifyProjectAccess(req,project);if(project.archived_at)throw fail(409,'Archived projects are read-only.');}
    next();
  });

  installSurveyManagement({app,dbs,config,role,verifyProjectAccess,processor});

  // Projects Endpoints
  app.get('/api/projects', async (req, res) => {
    const dbClient = ['admin', 'reviewer'].includes(req.profile?.role) ? dbs.admin : req.db;
    const [projects, progress] = await Promise.all([
      allRows(() => dbClient.from('projects').select('*').order('created_at', { ascending: false }).order('id')),
      allRows(() => dbClient.from('project_progress').select('*'))
    ]);
    const progressById=new Map(progress.map(p=>[p.project_id,p]));
    res.json(projects.filter(p=>req.query.archived==='1'?Boolean(p.archived_at):!p.archived_at).map(p => {
      const isProtected = Boolean(p.access_password && p.access_password.trim());
      const unlockToken = req.headers['x-project-unlock-token'];
      const isUnlockedToken = unlockToken && unlockToken === generateUnlockToken(req.actor, p.id);
      const isUnlockedSession = unlockedSessions.get(req.token)?.get(p.id) === p.access_password;
      const hasAccess = req.profile?.role === 'admin' || !isProtected || isUnlockedToken || isUnlockedSession;
      return {
        ...p,
        access_password: undefined,
        is_password_protected: isProtected,
        is_unlocked: hasAccess,
        progress: progressById.get(p.id) || {
          survey_count: 0, required: 0, collected: 0, pending: 0, verified: 0, rejected: 0, under_review: 0, collection_percentage: 0, verification_percentage: 0
        }
      };
    }));
  });

  app.post('/api/projects', role('admin', 'collector'), async (req, res) => {
    const data = projectSchema.parse(req.body);
    if(data.access_password)data.access_password=await hashPassword(data.access_password);
    const id = await rpc(req,'save_project', { p_actor: req.actor, p_data: data });
    res.status(201).json({ id });
  });

  app.post('/api/projects/:id/unlock', async (req, res) => {
    const id = uuid.parse(req.params.id);
    // Use admin client (bypasses RLS) so any authenticated user can attempt
    // to unlock a password-protected project, even if they are not yet in
    // project_members (which is the whole point of the unlock flow).
    const project = await projectAccess(dbs.admin, id);
    const expected = (project.access_password || '').trim();
    if (!expected) {
      return res.json({ success: true, unlocked: true, unlock_token: generateUnlockToken(req.actor, id) });
    }
    const { password } = unlockProjectSchema.parse(req.body);
    if (!await checkPassword(password,expected)) {
      throw fail(403, 'Incorrect project access password.');
    }
    if(!unlockedSessions.has(req.token))unlockedSessions.set(req.token,new Map());
    unlockedSessions.get(req.token).set(id,expected);
    await dbs.admin.from('project_members').upsert({ project_id: id, user_id: req.actor });
    res.json({
      success: true,
      unlocked: true,
      unlock_token: generateUnlockToken(req.actor, id),
      project_name: project.project_name
    });
  });

  app.get('/api/projects/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const dbClient = ['admin', 'reviewer'].includes(req.profile?.role) ? dbs.admin : req.db;
    const [project, progress] = await Promise.all([
      projectAccess(dbClient, id),
      dbClient.from('project_progress').select('*').eq('project_id', id).maybeSingle().then(r => r.data)
    ]);
    await verifyProjectAccess(req, project);
    res.json({
      ...project,
      access_password: undefined,
      is_password_protected: Boolean(project.access_password && project.access_password.trim()),
      is_unlocked: true,
      progress: progress || {
        survey_count: 0, required: 0, collected: 0, pending: 0, verified: 0, rejected: 0, under_review: 0, collection_percentage: 0, verification_percentage: 0
      }
    });
  });

  app.put('/api/projects/:id', role('admin', 'collector'), async (req, res) => {
    const id = uuid.parse(req.params.id);
    await projectAccess(req.db, id);
    const data = projectSchema.parse(req.body);
    if(data.access_password)data.access_password=await hashPassword(data.access_password);
    await rpc(req,'save_project', { p_actor: req.actor, p_id: id, p_data: data });
    res.json({ id });
  });

  // Delete a project — admin only (includes Founder who is an admin)
  app.delete('/api/projects/:id', role('admin'), async (req, res) => {
    const id = uuid.parse(req.params.id);
    const project = await projectAccess(dbs.admin, id); // bypass RLS
    // Delete files, documents, properties, and project members belonging to this project
    const propIds = (await allRows(() => dbs.admin.from('properties').select('id').eq('project_id', id))).map(p => p.id);
    if (propIds.length) {
      const docIds = (await allRows(() => dbs.admin.from('property_documents').select('id').in('property_id', propIds))).map(d => d.id);
      if (docIds.length) {
        await dbs.admin.from('uploaded_files').delete().in('property_document_id', docIds);
        await dbs.admin.from('property_documents').delete().in('id', docIds);
      }
      await dbs.admin.from('properties').delete().in('id', propIds);
    }
    await dbs.admin.from('project_members').delete().eq('project_id', id);
    // Delete the project record
    await dbs.admin.from('projects').delete().eq('id', id);
    res.status(204).end();
  });

  app.get('/api/projects/:id/survey-numbers', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const dbClient = ['admin', 'reviewer'].includes(req.profile?.role) ? dbs.admin : req.db;
    const project = await projectAccess(dbClient, id);
    await verifyProjectAccess(req, project);
    const [surveys, progress] = await Promise.all([
      allRows(() => dbClient.from('properties').select('*').eq('project_id', id).order('survey_number').order('id')),
      allRows(() => dbClient.from('property_progress').select('*'))
    ]);
    res.json(surveys.map(s => ({ ...s, progress: progress.find(x => x.property_id === s.id) })));
  });

  app.post('/api/projects/:id/survey-numbers', role('admin', 'collector', 'reviewer'), async (req, res) => {
    const projectId = uuid.parse(req.params.id);
    const project = await projectAccess(req.db, projectId);
    const body = propertySchema.parse(req.body);
    body.project_id = projectId;
    if (!body.property_name) body.property_name = project.project_name;
    if (!body.village) body.village = project.village;
    if (!body.taluk) body.taluk = project.taluk;
    if (!body.district) body.district = project.district;
    const id = await rpc(req,'save_property', { p_actor: req.actor, p_data: body });
    res.status(201).json({ id });
  });

  app.get('/api/projects/:id/progress', async (req, res) => {
    const id = uuid.parse(req.params.id);
    await projectAccess(req.db, id);
    const progress = unwrap(await req.db.from('project_progress').select('*').eq('project_id', id).single());
    res.json(progress);
  });

  // Easy Status Checker endpoint: Project Matrix with all survey numbers and their 7 document statuses
  app.get('/api/projects/:id/matrix', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const dbClient = ['admin', 'reviewer'].includes(req.profile?.role) ? dbs.admin : req.db;
    const [project, progress, surveys] = await Promise.all([
      projectAccess(dbClient, id),
      dbClient.from('project_progress').select('*').eq('project_id', id).maybeSingle().then(r => r.data),
      allRows(() => dbClient.from('properties').select('*').eq('project_id', id).order('survey_number').order('id'))
    ]);
    await verifyProjectAccess(req, project);

    const surveyChecklists=await checklistsForProperties(dbClient,surveys);

    res.json({
      project: {
        ...project,
        access_password: undefined,
        is_password_protected: Boolean(project.access_password && project.access_password.trim()),
        is_unlocked: true
      },
      progress: progress || {
        survey_count: surveys.length, required: surveys.length * 7, collected: 0, pending: surveys.length * 7, verified: 0, rejected: 0, under_review: 0, collection_percentage: 0, verification_percentage: 0
      },
      survey_checklists: surveyChecklists
    });
  });

  // Survey Numbers aliases for direct REST access
  app.get('/api/survey-numbers/:id', async (req, res) => res.json(await propertyAccess(req.db, uuid.parse(req.params.id))));
  app.get('/api/survey-numbers/:id/progress', async (req, res) => {
    const id = uuid.parse(req.params.id);
    await propertyAccess(req.db, id);
    res.json(unwrap(await req.db.from('property_progress').select('*').eq('property_id', id).single()));
  });

  app.get('/api/checklists',async(req,res)=>{
    const limit=z.coerce.number().int().min(1).max(25).parse(req.query.limit||25);
    const offset=z.coerce.number().int().min(0).max(1000000).parse(req.query.offset||0);
    const dbClient = ['admin', 'reviewer'].includes(req.profile?.role) ? dbs.admin : req.db;
    const [properties,projects]=await Promise.all([
      allRows(()=>dbClient.from('properties').select('*').order('id')),
      allRows(()=>dbClient.from('projects').select('*').order('id'))
    ]);
    const projectMap=new Map(projects.map(p=>[p.id,p]));
    const active=properties.filter(p=>!p.project_id||!projectMap.get(p.project_id)?.archived_at);
    const accessible=[];let locked=0;
    for(const property of active.slice(offset,offset+limit)){
      const project=projectMap.get(property.project_id);
      try{if(project)await verifyProjectAccess(req,project);accessible.push(property);}
      catch(error){if(error.code!=='PROJECT_PASSWORD_REQUIRED')throw error;locked++;}
    }
    res.json({checklists:await checklistsForProperties(dbClient,accessible),hasMore:active.length>offset+limit,locked,offset,limit});
  });
  app.get('/api/properties',async(req,res)=>{
    const dbClient = ['admin', 'reviewer'].includes(req.profile?.role) ? dbs.admin : req.db;
    const [properties,progress]=await Promise.all([
      allRows(()=>dbClient.from('properties').select('*').order('created_at',{ascending:false}).order('id')),
      allRows(()=>dbClient.from('property_progress').select('*').order('property_id'))]);
    const projects=unwrap(await dbClient.from('projects').select('id,archived_at'));
    const active=new Set(projects.filter(p=>!p.archived_at).map(p=>p.id));
    const progressById=new Map(progress.map(p=>[p.property_id,p]));
    res.json(properties.filter(p=>!p.project_id||active.has(p.project_id)).map(p=>({...p,progress:progressById.get(p.id)})));
  });
  app.post('/api/properties',role('admin','collector','reviewer'),async(req,res)=>{
    const id=await rpc(req,'save_property',{p_actor:req.actor,p_data:propertySchema.parse(req.body)});res.status(201).json({id});
  });
  app.get('/api/properties/:id',async(req,res)=>res.json(await propertyAccess(req.db,uuid.parse(req.params.id))));
  app.put('/api/properties/:id',role('admin','collector','reviewer'),async(req,res)=>{
    const id=uuid.parse(req.params.id);await propertyAccess(req.db,id);
    await rpc(req,'save_property',{p_actor:req.actor,p_id:id,p_data:propertySchema.parse(req.body)});res.json({id});
  });
  app.get(['/api/properties/:id/checklist', '/api/survey-numbers/:id/checklist'], async (req, res) => {
    const propertyId = uuid.parse(req.params.id);
    const data = await checklist(req.db, propertyId);
    if (data.property?.project_id && req.profile.role !== 'admin') {
      const project = await projectAccess(req.db, data.property.project_id);
      await verifyProjectAccess(req, project);
    }
    data.property.project_archived_at=req.project?.archived_at||null;
    res.json(data);
  });
  app.get('/api/properties/:id/progress',async(req,res)=>{
    const id=uuid.parse(req.params.id);await propertyAccess(req.db,id);res.json(unwrap(await req.db.from('property_progress').select('*').eq('property_id',id).single()));
  });
  app.put('/api/documents/:id',writer,async(req,res)=>{
    const id=uuid.parse(req.params.id);await documentAccess(req.db,id);
    await rpc(req,'update_document',{p_actor:req.actor,p_document:id,p_data:collectionSchema.parse(req.body),p_review:false});res.json({success:true});
  });
  app.post('/api/documents/:id/verification',role('admin','reviewer'),async(req,res)=>{
    const id=uuid.parse(req.params.id);const doc=await documentAccess(req.db,id);
    const data=reviewSchema.parse(req.body);
    await rpc(req,'update_document',{p_actor:req.actor,p_document:id,p_data:data,p_review:true});
    if(mailer.enabled){
      propertyAccess(req.db,doc.property_id).then(property=>{
        return req.db.from('document_categories').select('name').eq('id',doc.document_category_id).maybeSingle().then(cat=>{
          return mailer.sendReviewAlert({
            property,
            categoryName:cat?.data?.name || 'Document',
            status:data.verification_status,
            reason:data.rejection_reason,
            remarks:data.remarks,
            reviewerName:req.profile?.full_name || 'Reviewer'
          });
        });
      }).catch(err=>console.error('[Mailer] Review alert error:',err.message));
    }
    res.json({success:true});
  });
  app.get('/api/documents/:id/files',async(req,res)=>{
    const id=uuid.parse(req.params.id);await documentAccess(req.db,id);
    res.json(await allRows(()=>req.db.from('uploaded_files').select('*, uploader:profiles!uploaded_by(full_name)').eq('property_document_id',id).order('uploaded_at').order('id')));
  });
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:config.maxFileBytes,files:1,fields:1,fieldSize:100}}).single('file');
  app.post(['/api/documents/:documentId/files', '/api/properties/:propertyId/documents/:documentId/files'],writer,
    rateLimit({windowMs:60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false}),
    async(req,_res,next)=>{req.document=await documentAccess(req.db,uuid.parse(req.params.documentId),req.params.propertyId?uuid.parse(req.params.propertyId):undefined);next();},upload,async(req,res)=>{
      const replaceId=req.body.replace_id?uuid.parse(req.body.replace_id):null;
      if(replaceId){
        if(!['admin','collector','user'].includes(req.profile.role)) throw fail(403,'Reviewers cannot replace existing files.');
        const previous=await fileAccess(req.db,replaceId);
        if(previous.property_document_id!==req.document.id) throw fail(400,'Replacement must belong to this category.');
        if(req.profile.role !== 'admin' && previous.uploaded_by !== req.actor) throw fail(403, 'You cannot replace another user\'s file.');
      }
      const file=await persistUpload({admin:{...dbs.admin,rpc:(name,args)=>dbs.admin.rpc('survey_run',{p_actor:req.actor,p_operation:name,p_args:args,p_ip:req.ip})},config,actor:req.actor,document:req.document,file:req.file,replaceId});

      await dbs.flush?.();
      processor.enqueue(file.id);
      res.status(201).json({...file,processing_status:'Uploaded'});
    });
  app.get('/api/files/:id/url',async(req,res)=>{
    const f=await fileAccess(req.db,uuid.parse(req.params.id));
    const result=await dbs.admin.storage.from(config.bucket).createSignedUrl(f.storage_path,60,req.query.download==='1'?{download:f.original_file_name}:{});
    if(result.error) throw fail(502,'Could not open this file.');res.json({url:result.data.signedUrl,expiresIn:60});
  });
  app.delete('/api/files/:id',role('admin','reviewer'),async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const f=await fileAccess(req.db,id);
    if(req.profile.role !== 'admin' && f.uploaded_by !== req.actor) {
      throw fail(403,'You cannot delete another user\'s document.');
    }
    await rpc(req,'remove_file',{p_actor:req.actor,p_file:id});res.status(204).end();
  });

  // Upload History & Analysis Endpoints
  app.get('/api/analyses/:uploadId', async (req, res) => {
    const uploadId = uuid.parse(req.params.uploadId);
    await fileAccess(req.db, uploadId);
    const analysis = unwrap(await req.db.from('document_analyses').select('*').eq('upload_id', uploadId).maybeSingle());
    if (!analysis) {
      return res.json({ analysis: null, extracted_surveys: [] });
    }
    const extracted = await allRows(() => req.db.from('extracted_survey_numbers').select('*').eq('analysis_id', analysis.id).order('s_no'));
    res.json({ analysis, extracted_surveys: extracted });
  });

  app.get('/api/analyses/:uploadId/export', async (req, res) => {
    const uploadId = uuid.parse(req.params.uploadId);
    const format = z.enum(['csv', 'xlsx']).parse(req.query.format || 'csv');
    await fileAccess(req.db, uploadId);
    const analysis = unwrap(await req.db.from('document_analyses').select('*').eq('upload_id', uploadId).maybeSingle());
    if (!analysis) throw fail(404, 'Analysis record not found for this document.');
    const records = await allRows(() => req.db.from('extracted_survey_numbers').select('*').eq('analysis_id', analysis.id).order('s_no'));

    const sanitizeFormula = (val) => {
      const s = String(val ?? '');
      return /^[\s]*[=+\-@]/.test(s) ? `'${s}` : s;
    };

    const headers = ['S.No.', 'Survey Number', 'Subdivision', 'Village', 'Taluk', 'District', 'Plot Number', 'Extent', 'Patta Number', 'Source Reference', 'Source File Name'];
    const dataRows = records.map((r, idx) => [
      idx + 1,
      sanitizeFormula(r.survey_number),
      sanitizeFormula(r.subdivision),
      sanitizeFormula(r.village),
      sanitizeFormula(r.taluk),
      sanitizeFormula(r.district),
      sanitizeFormula(r.plot_number),
      sanitizeFormula(r.extent),
      sanitizeFormula(r.patta_number),
      sanitizeFormula(r.source_reference),
      sanitizeFormula(r.source_file_name)
    ]);

    const baseFileName = (analysis.original_file_name || 'survey_analysis').replace(/[^a-zA-Z0-9_-]/g, '_');

    if (format === 'csv') {
      const escapeCsv = (str) => `"${String(str).replace(/"/g, '""')}"`;
      const csvContent = [headers.map(escapeCsv).join(','), ...dataRows.map(r => r.map(escapeCsv).join(','))].join('\r\n');
      res.attachment(`${baseFileName}_survey_analysis.csv`).type('text/csv; charset=utf-8').send(csvContent);
    } else {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
      XLSX.utils.book_append_sheet(wb, ws, 'Survey Analysis');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.attachment(`${baseFileName}_survey_analysis.xlsx`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buffer);
    }
  });
  app.get('/api/properties/:id/audit',async(req,res)=>{
    const id=uuid.parse(req.params.id);await propertyAccess(req.db,id);
    res.json(unwrap(await req.db.from('audit_logs').select('*, actor:profiles!actor_id(full_name)').eq('property_id',id).order('created_at',{ascending:false}).limit(100)));
  });
  app.get('/api/users',role('admin'),async(req,res)=>res.json(await allRows(()=>req.db.from('profiles').select('id,full_name,role').order('id'))));
  app.get('/api/properties/:id/members',role('admin'),async(req,res)=>{
    const id=uuid.parse(req.params.id);res.json(unwrap(await req.db.from('property_members').select('*, profile:profiles!user_id(full_name,role)').eq('property_id',id)));
  });
  app.post('/api/properties/:id/members',role('admin'),async(req,res)=>{
    const body=z.object({user_id:uuid,remove:z.boolean().default(false)}).strict().parse(req.body);
    await rpc(req,'manage_member',{p_actor:req.actor,p_property:uuid.parse(req.params.id),p_user:body.user_id,p_remove:body.remove});res.json({success:true});
  });
  app.get('/api/reports/summary',async(req,res)=>{
    const dbClient = ['admin', 'reviewer'].includes(req.profile?.role) ? dbs.admin : req.db;
    const [allProgress,allProjects,allProperties]=await Promise.all([
      allRows(()=>dbClient.from('property_progress').select('*').order('property_id')),
      allRows(()=>dbClient.from('projects').select('id,archived_at')),
      allRows(()=>dbClient.from('properties').select('id,project_id'))
    ]);
    const projects=allProjects.filter(p=>!p.archived_at);
    const active=new Set(projects.map(p=>p.id));
    const propertyIds=new Set(allProperties.filter(p=>!p.project_id||active.has(p.project_id)).map(p=>p.id));
    const rows=allProgress.filter(p=>propertyIds.has(p.property_id));
    const sum=key=>rows.reduce((n,r)=>n+Number(r[key]),0);
    const totalSurveys=rows.length;
    const totalRequired=totalSurveys*7;
    const collected=sum('collected');
    const verified=sum('verified');
    const pending=totalRequired-collected;
    const rejected=sum('rejected');
    const underReview=sum('under_review');
    const collectionPercentage=totalRequired?+(collected/totalRequired*100).toFixed(2):0;
    const verificationPercentage=totalRequired?+(verified/totalRequired*100).toFixed(2):0;

    res.json({
      total_projects:projects.length,
      total_surveys:totalSurveys,
      total_required:totalRequired,
      total_collected:collected,
      total_pending:pending,
      total_verified:verified,
      total_rejected:rejected,
      total_under_review:underReview,
      overall_collection_percentage:collectionPercentage,
      overall_verification_percentage:verificationPercentage,
      properties:totalSurveys,
      required:totalRequired,
      collected,
      pending,
      verified,
      rejected,
      under_review:underReview,
      collection_percentage:collectionPercentage,
      verification_percentage:verificationPercentage
    });
  });
  app.get('/api/reports/export',async(req,res)=>{
    const filter=z.enum(['all','pending','verified','rejected']).parse(req.query.filter||'all');
    const format=z.enum(['csv','pdf']).parse(req.query.format||'csv');
    let ids = [];
    if(req.query.project_id) {
      const pId = uuid.parse(req.query.project_id);
      ids = (await allRows(()=>req.db.from('properties').select('id').eq('project_id',pId).order('survey_number'))).map(p=>p.id);
    } else if(req.query.property_id) {
      ids = [uuid.parse(req.query.property_id)];
    } else {
      ids = (await allRows(()=>req.db.from('properties').select('id').order('id'))).map(p=>p.id);
    }
    const properties=await Promise.all(ids.map(id=>propertyAccess(req.db,id)));
    const scoped=[];
    for(const property of properties){if(property.project_id){const project=await projectAccess(req.db,property.project_id);if(project.archived_at&&!req.query.project_id&&!req.query.property_id&&!req.body?.project_id&&!req.body?.property_id)continue;await verifyProjectAccess(req,project);}scoped.push(property);}
    const sets=await checklistsForProperties(req.db,scoped);
    const rows=reportRows(sets,filter);
    res.attachment(`dnassets-${filter}.${format}`).type(format==='pdf'?'application/pdf':'text/csv; charset=utf-8').send(format==='pdf'?await pdfReport(rows):csvReport(rows));
  });
  app.post('/api/reports/email',async(req,res)=>{
    const body=z.object({
      filter:z.enum(['all','pending','verified','rejected']).default('all'),
      format:z.enum(['csv','pdf']).default('pdf'),
      property_id:uuid.optional().nullable(),
      project_id:uuid.optional().nullable(),
      to:z.string().email().optional()
    }).parse(req.body);
    let ids = [];
    if(body.project_id) {
      ids = (await allRows(()=>req.db.from('properties').select('id').eq('project_id',body.project_id).order('survey_number'))).map(p=>p.id);
    } else if(body.property_id) {
      ids = [body.property_id];
    } else {
      ids = (await allRows(()=>req.db.from('properties').select('id').order('id'))).map(p=>p.id);
    }
    const properties=await Promise.all(ids.map(id=>propertyAccess(req.db,id)));
    const scoped=[];
    for(const property of properties){if(property.project_id){const project=await projectAccess(req.db,property.project_id);if(project.archived_at&&!req.query.project_id&&!req.query.property_id&&!req.body?.project_id&&!req.body?.property_id)continue;await verifyProjectAccess(req,project);}scoped.push(property);}
    const sets=await checklistsForProperties(req.db,scoped);
    const rows=reportRows(sets,body.filter);
    const buffer=body.format==='pdf'?await pdfReport(rows):Buffer.from(csvReport(rows),'utf8');
    let property=null;if(body.property_id) property=await propertyAccess(req.db,body.property_id);
    const result=await mailer.sendReportEmail({to:body.to || config.smtp?.user,property,format:body.format,fileBuffer:buffer});
    if(result.error) throw fail(502,`Email delivery failed: ${result.error}`);
    res.json({success:true,sentTo:body.to || config.smtp?.user});
  });
  app.use('/api',(_req,_res,next)=>next(fail(404,'Endpoint not found.')));
  app.use(express.static(fileURLToPath(new URL('../../frontend',import.meta.url)),{index:'index.html',dotfiles:'deny'}));
  app.use((error,req,res,_next)=>{
    if(req.aborted || res.destroyed)return;
    res.removeHeader('Content-Disposition');
    res.type('application/json');
    let status=error.status || 500;let message=error.message;
    if(error instanceof z.ZodError){status=400;message=error.issues.map(i=>i.message).join(' ');}
    if(error instanceof multer.MulterError){status=error.code==='LIMIT_FILE_SIZE'?413:400;message='Upload rejected. Check the file size and send one file per request.';}
    if(status>=500 && !error.status){
      console.error('Request failed:', error.stack || error);
      message = error.message || 'The request could not be completed.';
    }
    res.status(status).json({ error: message, message, details: error.message, code: error.code, projectId: error.projectId });
  });
  app.locals.cleanup=()=>config.configured?cleanupStorage(dbs.admin,config.bucket):Promise.resolve();
  return app;
}
