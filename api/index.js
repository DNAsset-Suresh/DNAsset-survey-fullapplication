import { createApp } from '../backend/src/app.js';
import { configuration } from '../backend/src/config.js';
import { initFirebaseClients } from '../backend/src/services/firebaseDatabase.js';

if (process.env.VERCEL === undefined) {
  process.env.VERCEL = '1';
}
if (process.env.USE_FIREBASE === undefined) {
  process.env.USE_FIREBASE = 'true';
}

let appInstance = null;

async function getApp() {
  if (appInstance) return appInstance;
  const config = configuration();
  let clients = null;
  if (process.env.USE_FIREBASE !== 'false' || config.useFirebase) {
    clients = await initFirebaseClients(config);
  }
  appInstance = createApp(config, clients);
  return appInstance;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (error) {
    console.error('[Vercel Serverless Invocation Error]:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: 'Function Invocation Failed',
        message: error.message || 'Internal server error'
      }));
    }
  }
}
