import { createApp } from '../backend/src/app.js';
import { configuration } from '../backend/src/config.js';
import { initFirebaseClients } from '../backend/src/services/firebaseDatabase.js';

let appPromise = null;

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const config = configuration();
      let clients = null;
      if (process.env.USE_FIREBASE === 'true' || config.useFirebase) {
        clients = await initFirebaseClients(config);
      }
      return createApp(config, clients);
    })();
  }
  return appPromise;
}

export default async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
}
