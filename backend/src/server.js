import { configuration } from './config.js';
import { createApp } from './app.js';
import { initLocalClients } from './services/localDatabase.js';
import { initFirebaseClients } from './services/firebaseDatabase.js';

const useFirebase = process.env.USE_FIREBASE === 'true';

// Default to local PostgreSQL if Supabase credentials are not provided and Firebase is not selected
if (!useFirebase && !process.env.SUPABASE_URL && process.env.USE_LOCAL_DB === undefined && process.env.NODE_ENV !== 'production') {
  process.env.USE_LOCAL_DB = 'true';
}

const config = configuration();
let clients = null;

if (useFirebase) {
  clients = await initFirebaseClients(config);
} else if (config.isLocal) {
  clients = await initLocalClients(config);
}

const app = createApp(config, clients);
const backendType = useFirebase ? 'Firebase (Firestore & Auth)' : (config.databaseUrl ? 'cloud database' : (config.isLocal ? 'saved local database' : 'Supabase'));
const server=app.listen(config.port,()=>console.log('DNAssets: http://localhost:'+config.port+' ('+backendType+')'));
app.locals.recoverUploads()?.catch(()=>console.error('Pending upload processing could not resume.'));
const cleanup=config.storageCleanupEnabled ? setInterval(()=>app.locals.cleanup().catch(()=>console.error('Storage cleanup will retry.')),60000) : null;
const keepAlive = setInterval(() => {}, 60000);
let stopping=false;
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{
 if(stopping)return;stopping=true;clearInterval(cleanup);clearInterval(keepAlive);
 server.close(async()=>{try{await app.locals.drainUploads();await clients?.flush?.();await clients?.dbInstance?.close?.();process.exit(0);}catch{console.error('Shutdown failed to persist data.');process.exit(1);}});
});
