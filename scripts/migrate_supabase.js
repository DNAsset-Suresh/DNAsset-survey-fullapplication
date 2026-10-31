import { configuration } from '../backend/src/config.js';
import { initLocalClients } from '../backend/src/services/localDatabase.js';
const config=configuration();
if(!config.isLocal)throw Error('Configure USE_LOCAL_DB or DATABASE_URL and a trusted PGSSLROOTCERT.');
const client=await initLocalClients(config);
await client.flush();await client.dbInstance.close();console.log('Nondestructive schema migrations completed.');
