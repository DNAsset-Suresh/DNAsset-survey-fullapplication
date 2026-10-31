import {configuration} from '../backend/src/config.js';
import {initLocalClients} from '../backend/src/services/localDatabase.js';
import {createApp} from '../backend/src/app.js';
const config=configuration({...process.env,USE_LOCAL_DB:'true'});
const clients=await initLocalClients(config);
clients.mailer={enabled:false};
const app=createApp({...config,smtp:{...config.smtp,enabled:false}},clients);
const server=app.listen(3000,'127.0.0.1',()=>console.log('Local validation server: http://localhost:3000; email disabled.'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await app.locals.drainUploads();await clients.flush();await clients.dbInstance.close();process.exit(0);}));
