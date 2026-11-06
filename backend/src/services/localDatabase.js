import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFile, mkdir, writeFile, unlink, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { hashPassword, checkPassword, containedPath, sessionStore } from './localSecurity.js';

function createLocalStorage(baseDir, signedDownloads) {
  return {
    from(bucket) {
      const bucketDir = path.join(baseDir, bucket);
      return {
        async download(storagePath) { try { return { data: new Blob([await readFile(containedPath(bucketDir, storagePath))]), error: null }; } catch (error) { return { data: null, error }; } },
        async upload(storagePath, buffer, _options) {
          try {
            const fullPath = containedPath(bucketDir, storagePath);
            await mkdir(path.dirname(fullPath), { recursive: true });
            await writeFile(fullPath, buffer, { flag: 'wx' });
            return { error: null };
          } catch (err) {
            return { error: err };
          }
        },
        async remove(paths) {
          try {
            for (const sp of paths) {
              const fullPath = containedPath(bucketDir, sp);
              if (existsSync(fullPath)) {
                await unlink(fullPath);
              }
            }
            return { error: null };
          } catch (err) {
            return { error: err };
          }
        },
        async createSignedUrl(storagePath, _expiresIn, options = {}) {
          const token = crypto.randomBytes(32).toString('base64url');
          for (const [key, value] of signedDownloads) if (value.expires < Date.now()) signedDownloads.delete(key);
          signedDownloads.set(token, { path: containedPath(baseDir, bucket, storagePath), storagePath, filename: options.download, expires: Date.now() + Math.min(_expiresIn, 60) * 1000 });
          return { data: { signedUrl: '/api/storage/download/' + token }, error: null };
        }
      };
    }
  };
}

function createTableQuery(db, table, _actorId, onMutation) {
  let selectFields = '*';
  const wheres = [];
  const params = [];
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
      params.push(val);
      wheres.push(`"${col}" = $${params.length}`);
      return builder;
    },
    in(col, vals) {
      if (!vals || vals.length === 0) {
        wheres.push('1 = 0');
      } else {
        const placeholders = vals.map(v => {
          params.push(v);
          return `$${params.length}`;
        }).join(', ');
        wheres.push(`"${col}" IN (${placeholders})`);
      }
      return builder;
    },
    order(col, { ascending = true } = {}) {
      orders.push(`"${col}" ${ascending ? 'ASC' : 'DESC'}`);
      return builder;
    },
    limit(n) {
      limitCount = n;
      return builder;
    },
    range(start, end) {
      offsetCount = start;
      limitCount = end - start + 1;
      return builder;
    },
    delete() {
      isDelete = true;
      return builder;
    },
    async insert(rows) {
      try {
        const items = Array.isArray(rows) ? rows : [rows];
        if (items.length === 0) return { data: [], error: null };
        const inserted = [];
        for (const item of items) {
          const keys = Object.keys(item);
          const cols = keys.map(k => `"${k}"`).join(', ');
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
          const values = keys.map(k => {
            const v = item[k];
            if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
              return JSON.stringify(v);
            }
            return v;
          });
          const sql = `INSERT INTO public.${table} (${cols}) VALUES (${placeholders}) RETURNING *`;
          const res = await db.query(sql, values);
          if (res.rows && res.rows[0]) inserted.push(res.rows[0]);
        }
        onMutation?.();
        return { data: Array.isArray(rows) ? inserted : (inserted[0] || null), error: null };
      } catch (err) {
        return { data: null, error: { code: err.code || '500', message: err.message } };
      }
    },
    async upsert(row) {
      if (table === 'storage_cleanup' && row.storage_path) {
        await db.query('insert into storage_cleanup(storage_path) values($1) on conflict do nothing', [row.storage_path]);
        onMutation?.();
        return { data: null, error: null };
      }
      if (table === 'project_members' && row.project_id && row.user_id) {
        await db.query('insert into public.project_members(project_id, user_id) values($1, $2) on conflict do nothing', [row.project_id, row.user_id]);
        onMutation?.();
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    async then(resolve) {
      try {
        const result = await builder.execute();
        resolve(result);
      } catch (err) {
        resolve({ data: null, error: { code: err.code || '500', message: err.message } });
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
        if (isDelete) {
          let sql = `DELETE FROM public.${table}`;
          if (wheres.length) sql += ` WHERE ${wheres.join(' AND ')}`;
          await db.query(sql, params);
          onMutation?.();
          return { data: null, error: null };
        }

        if (isUpdate) {
          const setClauses = [];
          for (const [key, val] of Object.entries(updateValues || {})) {
            params.push(val);
            setClauses.push(`"${key}" = $${params.length}`);
          }
          if (setClauses.length === 0) return { data: null, error: null };
          let sql = `UPDATE public.${table} SET ${setClauses.join(', ')}`;
          if (wheres.length) sql += ` WHERE ${wheres.join(' AND ')}`;
          await db.query(sql, params);
          onMutation?.();
          return { data: null, error: null };
        }

        // Custom JOINs mapping PostgREST relationships
        if (table === 'property_documents' && selectFields.includes('category:document_categories')) {
          let sql = `
            SELECT d.*,
              jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'display_order', c.display_order, 'is_active', c.is_active) as category,
              case when r.id is not null then jsonb_build_object('full_name', r.full_name) else null end as reviewer
            FROM public.property_documents d
            JOIN public.document_categories c ON c.id = d.document_category_id
            LEFT JOIN public.profiles r ON r.id = d.reviewer_id
          `;
          if (wheres.length) sql += ` WHERE ${wheres.map(w => w.replace(/"([a-z_]+)"/g, 'd."$1"')).join(' AND ')}`;
          if (orders.length) sql += ` ORDER BY ${orders.map(w => w.replace(/"([a-z_]+)"/g, 'd."$1"')).join(', ')}`;
          if (limitCount !== null) sql += ` LIMIT ${limitCount}`;
          if (offsetCount !== null) sql += ` OFFSET ${offsetCount}`;
          const res = await db.query(sql, params);
          return { data: res.rows, error: null };
        }

        if (table === 'uploaded_files' && selectFields.includes('uploader:profiles')) {
          let sql = `
            SELECT f.*,
              case when p.id is not null then jsonb_build_object('full_name', p.full_name) else null end as uploader
            FROM public.uploaded_files f
            LEFT JOIN public.profiles p ON p.id = f.uploaded_by
          `;
          if (wheres.length) sql += ` WHERE ${wheres.map(w => w.replace(/"([a-z_]+)"/g, 'f."$1"')).join(' AND ')}`;
          if (orders.length) sql += ` ORDER BY ${orders.map(w => w.replace(/"([a-z_]+)"/g, 'f."$1"')).join(', ')}`;
          if (limitCount !== null) sql += ` LIMIT ${limitCount}`;
          if (offsetCount !== null) sql += ` OFFSET ${offsetCount}`;
          const res = await db.query(sql, params);
          return { data: res.rows, error: null };
        }

        if (table === 'audit_logs' && selectFields.includes('actor:profiles')) {
          let sql = `
            SELECT a.*,
              case when p.id is not null then jsonb_build_object('full_name', p.full_name) else null end as actor
            FROM public.audit_logs a
            LEFT JOIN public.profiles p ON p.id = a.actor_id
          `;
          if (wheres.length) sql += ` WHERE ${wheres.map(w => w.replace(/"([a-z_]+)"/g, 'a."$1"')).join(' AND ')}`;
          if (orders.length) sql += ` ORDER BY ${orders.map(w => w.replace(/"([a-z_]+)"/g, 'a."$1"')).join(', ')}`;
          if (limitCount !== null) sql += ` LIMIT ${limitCount}`;
          if (offsetCount !== null) sql += ` OFFSET ${offsetCount}`;
          const res = await db.query(sql, params);
          return { data: res.rows, error: null };
        }

        if (table === 'property_members' && selectFields.includes('profile:profiles')) {
          let sql = `
            SELECT m.*,
              case when p.id is not null then jsonb_build_object('full_name', p.full_name, 'role', p.role) else null end as profile
            FROM public.property_members m
            LEFT JOIN public.profiles p ON p.id = m.user_id
          `;
          if (wheres.length) sql += ` WHERE ${wheres.map(w => w.replace(/"([a-z_]+)"/g, 'm."$1"')).join(' AND ')}`;
          if (orders.length) sql += ` ORDER BY ${orders.map(w => w.replace(/"([a-z_]+)"/g, 'm."$1"')).join(', ')}`;
          if (limitCount !== null) sql += ` LIMIT ${limitCount}`;
          if (offsetCount !== null) sql += ` OFFSET ${offsetCount}`;
          const res = await db.query(sql, params);
          return { data: res.rows, error: null };
        }

        // Standard SELECT
        let sql = `SELECT ${selectFields === '*' ? '*' : selectFields} FROM public.${table}`;
        if (wheres.length) sql += ` WHERE ${wheres.join(' AND ')}`;
        if (orders.length) sql += ` ORDER BY ${orders.join(', ')}`;
        if (limitCount !== null) sql += ` LIMIT ${limitCount}`;
        if (offsetCount !== null) sql += ` OFFSET ${offsetCount}`;

        const res = await db.query(sql, params);
        return { data: res.rows, error: null };
      } catch (err) {
        return { data: null, error: { code: err.code || '500', message: err.message } };
      }
    }
  };

  return builder;
}

export async function initLocalClients(config) {
  const dumpFile = path.resolve(config.localDatabaseFile || 'database/survey_db.tar.gz');
  const storageDir = path.resolve(config.storageDirectory || 'storage');
  await mkdir(path.dirname(dumpFile), { recursive: true });
  await mkdir(path.join(storageDir, config.bucket || 'land-documents'), { recursive: true });

  const isRemote = Boolean(config.databaseUrl);
  let db;
  let loadedFromSnapshot = false;

  if (isRemote) {
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: { rejectUnauthorized: true, ...(config.databaseCaFile ? { ca: await readFile(config.databaseCaFile, 'utf8') } : {}) }
    });
    db = {
      isRemote: true,
      query: (sql, params) => pool.query(sql, params),
      exec: (sql) => pool.query(sql),
      close: () => pool.end(),
      async transaction(fn) {
        const connection = await pool.connect();
        try { await connection.query('begin'); const result = await fn({ query: (sql, args) => connection.query(sql, args) }); await connection.query('commit'); return result; }
        catch (error) { await connection.query('rollback'); throw error; } finally { connection.release(); }
      }
    };
    loadedFromSnapshot = true;
    console.log('[PostgreSQL] Connected directly to Supabase cloud database.');
  } else if (existsSync(dumpFile)) {
    try {
      const fileData = await readFile(dumpFile);
      db = new PGlite({ loadDataDir: new Blob([fileData]) });
      await db.waitReady;
      await db.exec('SELECT 1');
      loadedFromSnapshot = true;
    } catch (err) {
      throw new Error('Saved database cannot be loaded. Restore a verified backup; refusing to create an empty replacement.', { cause: err });
    }
  }

  if (!db) {
    db = new PGlite();
    await db.waitReady;
    await db.exec('SELECT 1');
  }

  // Snapshot persistence helpers using dumpDataDir('gzip')
  let persistTimer = null;
  let persistence = Promise.resolve();
  function doPersist() {
    if (isRemote) return Promise.resolve();
    persistence = persistence.then(async () => {
      const blob = await db.dumpDataDir('gzip');
      await writeFile(dumpFile + '.tmp', Buffer.from(await blob.arrayBuffer()));
      await rename(dumpFile + '.tmp', dumpFile);
    });
    return persistence;
  }
  function persistDb() {
    if (isRemote) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => doPersist().catch(() => console.error('Database persistence failed. Check disk space and backup.')), 1500);
    persistTimer.unref();
  }
  async function flushDb() { clearTimeout(persistTimer); await doPersist(); }

  // Check if already initialized
  let alreadyInitialized = false;
  if (isRemote) {
    alreadyInitialized = true;
  } else {
    const check = await db.query("select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'profiles') as ex");
    alreadyInitialized = check.rows[0]?.ex;
  }

  if (!alreadyInitialized) {
    console.log('[Local PostgreSQL] Initializing schemas & migrations...');
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema if not exists auth;
      create table if not exists auth.users (
        id uuid primary key default gen_random_uuid(),
        email text unique,
        password text,
        raw_user_meta_data jsonb default '{}'
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      create schema if not exists storage;
      create table if not exists storage.buckets (
        id text primary key,
        name text,
        public boolean,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table if not exists storage.objects (
        id uuid default gen_random_uuid(),
        bucket_id text,
        name text
      );
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated;
      grant select, insert, update, delete on storage.objects to anon, authenticated;
    `);

    for (const name of ['001_initial_schema', '002_seed_document_categories', '003_security_policies', '004_transactional_operations', '005_project_wise_survey_hierarchy', '006_project_access_password', '007_upload_tracking_and_analysis', '017_survey_schedules_and_pr_chains']) {
      const sql = await readFile(path.resolve(`database/migrations/${name}.sql`), 'utf8');
      await db.exec(sql);
    }
    console.log('[Local PostgreSQL] Migrations applied successfully.');
  } else {
    // Check if 005 migration was applied to this snapshot
    const checkProjects = await db.query("select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'projects') as ex");
    if (!checkProjects.rows[0]?.ex) {
      console.log('[Local PostgreSQL] Applying 005_project_wise_survey_hierarchy.sql to existing snapshot...');
      const sql005 = await readFile(path.resolve('database/migrations/005_project_wise_survey_hierarchy.sql'), 'utf8');
      await db.exec(sql005);
      await flushDb();
      console.log('[Local PostgreSQL] 005_project_wise_survey_hierarchy applied successfully.');
    }

    // Check if 006 migration was applied to this snapshot
    const check006 = await db.query("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'access_password') as ex");
    if (!check006.rows[0]?.ex) {
      console.log('[Local PostgreSQL] Applying 006_project_access_password.sql to existing snapshot...');
      const sql006 = await readFile(path.resolve('database/migrations/006_project_access_password.sql'), 'utf8');
      await db.exec(sql006);
      await flushDb();
      console.log('[Local PostgreSQL] 006_project_access_password applied successfully.');
    }

    // Check if 007 migration was applied to this snapshot
    const check007 = await db.query("select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'upload_history') as ex");
    if (!check007.rows[0]?.ex) {
      console.log('[Local PostgreSQL] Applying 007_upload_tracking_and_analysis.sql to existing snapshot...');
      const sql007 = await readFile(path.resolve('database/migrations/007_upload_tracking_and_analysis.sql'), 'utf8');
      await db.exec(sql007);
      await flushDb();
      console.log('[Local PostgreSQL] 007_upload_tracking_and_analysis applied successfully.');
    }

  }

  const repairApplied = await db.query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='archived_at') as ex");
  if (!repairApplied.rows[0].ex) await db.exec(await readFile(path.resolve('database/migrations/009_safety_and_history.sql'), 'utf8'));
  await db.exec(await readFile(path.resolve('database/migrations/010_delete_role_permissions.sql'), 'utf8'));
  const upgradeApplied = await db.query("select exists(select 1 from information_schema.tables where table_schema='public' and table_name='document_reviews') as ex");
  if (!upgradeApplied.rows[0].ex) await db.exec(await readFile(path.resolve('database/migrations/011_tracking_and_management.sql'), 'utf8'));
  const displayFix = await db.query("select pg_get_functiondef('private.record_upload_history()'::regprocedure) as definition,pg_get_functiondef('private.enrich_audit()'::regprocedure) as audit_definition");
  if (!displayFix.rows[0].definition.includes('right(p.survey_number') || !displayFix.rows[0].audit_definition.includes('right(p.survey_number')) await db.exec(await readFile(path.resolve('database/migrations/012_legacy_survey_display.sql'), 'utf8'));
  const reviewerAccessApplied = await db.query("select pg_get_functiondef('private.can_access_project(uuid,uuid)'::regprocedure) as definition");
  if (!reviewerAccessApplied.rows[0].definition.includes("'reviewer'")) {
    console.log('[Local PostgreSQL] Applying 014_reviewer_access.sql...');
    await db.exec(await readFile(path.resolve('database/migrations/014_reviewer_access.sql'), 'utf8'));
  }
  const schedulesApplied = await db.query("select exists(select 1 from information_schema.tables where table_schema='public' and table_name='project_schedules') as ex");
  if (!schedulesApplied.rows[0]?.ex) {
    console.log('[Local PostgreSQL] Applying 017_survey_schedules_and_pr_chains.sql...');
    await db.exec(await readFile(path.resolve('database/migrations/017_survey_schedules_and_pr_chains.sql'), 'utf8'));
  }
  if (!isRemote) await flushDb();
  const sessions = sessionStore();
  const signedDownloads = new Map();
  const actorDatabase = actorId => ({
    query: (sql, args) => db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [actorId || '']);
      await tx.query('set local role authenticated');
      return tx.query(sql, args);
    })
  });

  async function rpc(name, args) {
    try {
      const upgradeFunctions = { survey_run: ['p_actor', 'p_operation', 'p_args', 'p_ip'], survey_history: ['p_actor', 'p_filters'], survey_activity: ['p_actor', 'p_filters'], survey_delete_preview: ['p_actor', 'p_scope', 'p_id'], survey_destroy: ['p_actor', 'p_scope', 'p_id', 'p_fingerprint', 'p_phrase', 'p_confirmed', 'p_operation', 'p_ip'], survey_archive: ['p_actor', 'p_id', 'p_archived', 'p_ip'], survey_backup: ['p_actor'] };
      if (upgradeFunctions[name]) {
        const keys = upgradeFunctions[name]; const values = keys.map(k => typeof args[k] === 'object' && args[k] !== null ? JSON.stringify(args[k]) : args[k] ?? null);
        const result = await db.query('select public.' + name + '(' + keys.map((_, i) => '$' + (i + 1)).join(',') + ') as value', values);
        if (['survey_run', 'survey_destroy', 'survey_archive'].includes(name)) persistDb();
        return { data: result.rows[0].value, error: null };
      }
      if (name === 'save_project') {
        const { p_actor, p_data, p_id = null } = args;
        const res = await db.query('SELECT public.save_project($1, $2::jsonb, $3) as id', [p_actor, JSON.stringify(p_data), p_id]);
        persistDb();
        return { data: res.rows[0].id, error: null };
      }
      if (name === 'save_property') {
        const { p_actor, p_data, p_id = null } = args;
        const res = await db.query('SELECT public.save_property($1, $2::jsonb, $3) as id', [p_actor, JSON.stringify(p_data), p_id]);
        persistDb();
        return { data: res.rows[0].id, error: null };
      }
      if (name === 'update_document') {
        const { p_actor, p_document, p_data, p_review = false } = args;
        await db.query('SELECT public.update_document($1, $2, $3::jsonb, $4)', [p_actor, p_document, JSON.stringify(p_data), p_review]);
        persistDb();
        return { data: null, error: null };
      }
      if (name === 'commit_file') {
        const { p_actor, p_document, p_file, p_replace = null } = args;
        const res = await db.query('SELECT public.commit_file($1, $2, $3::jsonb, $4) as id', [p_actor, p_document, JSON.stringify(p_file), p_replace]);
        persistDb();
        return { data: res.rows[0].id, error: null };
      }
      if (name === 'remove_file') {
        const { p_actor, p_file } = args;
        await db.query('SELECT public.remove_file($1, $2)', [p_actor, p_file]);
        persistDb();
        return { data: null, error: null };
      }
      if (name === 'manage_member') {
        const { p_actor, p_property, p_user, p_remove = false } = args;
        await db.query('SELECT public.manage_member($1, $2, $3, $4)', [p_actor, p_property, p_user, p_remove]);
        persistDb();
        return { data: null, error: null };
      }
      throw new Error(`Unknown RPC function: ${name}`);
    } catch (err) {
      return { data: null, error: { code: err.code || '500', message: err.message } };
    }
  }

  const localStorage = createLocalStorage(storageDir, signedDownloads);
  return {
    dbInstance: db, flush: flushDb, signedDownloads,
    snapshotBackup: isRemote ? null : async file => { await flushDb(); await writeFile(file, await readFile(dumpFile), { flag: 'wx' }); },
    admin: {
      auth: {
        async getUser(token) {
          const payload = sessions.verify(token);
          if (!payload) return { data: { user: null }, error: { message: 'Invalid session' } };
          const user = (await db.query('select id,email from auth.users where id=$1', [payload.sub])).rows[0];
          return { data: { user: user || null }, error: null };
        },
        admin: {
          async signOut(token) { sessions.revoke(token); return { error: null }; },
          async updateUserById(id, { password, email, user_metadata = {} } = {}) {
            try {
              if (password) {
                if (isRemote) await db.query("update auth.users set encrypted_password=extensions.crypt($1,extensions.gen_salt('bf')) where id=$2", [password, id]);
                else await db.query('update auth.users set password=$1 where id=$2', [await hashPassword(password), id]);
                sessions.revokeUser(id);
              }
              if (email) await db.query('update auth.users set email=$1 where id=$2', [email.toLowerCase().trim(), id]);
              if (user_metadata.full_name !== undefined) await db.query('update profiles set full_name=$1 where id=$2', [user_metadata.full_name, id]);
              await flushDb(); return { data: { user: { id } }, error: null };
            } catch (error) { return { data: null, error: { message: 'User update failed' } }; }
          },
          async listUsers() { try { return { data: { users: (await db.query('select p.id,u.email,p.full_name,p.role,p.created_at from profiles p join auth.users u on u.id=p.id order by p.created_at')).rows }, error: null }; } catch (error) { return { data: null, error }; } }
        }
      }, rpc, storage: localStorage, from: table => createTableQuery(db, table, null, persistDb)
    },
    anonymous: () => ({
      auth: {
        async signInWithPassword({ email, password }) {
          let cleanEmail = (email || '').trim().toLowerCase();
          if (cleanEmail === 'reviewer' || cleanEmail === 'naresh') cleanEmail = 'reviewer@dnassets.com';
          else if (cleanEmail === 'admin' || cleanEmail === 'administrator') cleanEmail = 'dna.callus@gmail.com';
          else if (cleanEmail === 'dna' || cleanEmail === 'suresh' || cleanEmail === 'callus') cleanEmail = 'dna.callus@gmail.com';
          else if (cleanEmail === 'user') cleanEmail = 'user@dnassets.com';
          let user;
          if (isRemote) { user = (await db.query('select id,email from auth.users where lower(email)=$1 and encrypted_password=extensions.crypt($2,encrypted_password)', [cleanEmail, password])).rows[0]; }
          else {
            user = (await db.query('select id,email,password from auth.users where lower(email)=$1', [cleanEmail])).rows[0];
            if (!user || !await checkPassword(password, user.password)) user = null;
            else if (!user.password.startsWith('scrypt:')) { await db.query('update auth.users set password=$1 where id=$2', [await hashPassword(password), user.id]); await flushDb(); }
          }
          return user ? { data: { session: sessions.issue(user) }, error: null } : { data: { session: null }, error: { message: 'Email or password is incorrect.' } };
        },
        async refreshSession({ refresh_token }) { const session = sessions.refresh(refresh_token); return { data: { session }, error: session ? null : { message: 'Session expired' } }; }
      }
    }),
    user: token => ({ from: table => createTableQuery(actorDatabase(sessions.verify(token)?.sub), table, null, null) })
  };
}
