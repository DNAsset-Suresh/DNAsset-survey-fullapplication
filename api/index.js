import { createApp } from '../backend/src/app.js';
import { configuration } from '../backend/src/config.js';
import { initFirebaseClients } from '../backend/src/services/firebaseDatabase.js';

if (process.env.VERCEL === undefined) {
  process.env.VERCEL = '1';
}
if (process.env.USE_FIREBASE === undefined) {
  process.env.USE_FIREBASE = 'true';
}

let appPromise = null;

async function getApp() {
  if (!appPromise) appPromise = (async () => {
    const config = configuration();
    const clients = config.useFirebase ? await initFirebaseClients(config) : null;
    return createApp(config, clients);
  })().catch(error => { appPromise = null; throw error; });
  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    return new Promise((resolve, reject) => {
      res.on('finish', resolve);
      res.on('close', resolve);
      res.on('error', reject);
      app(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
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
