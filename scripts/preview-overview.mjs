// Static-only dashboard preview: no database initialization, migrations or uploads.
import express from 'express';
import { fileURLToPath } from 'node:url';
const app = express();
// The surrounding survey workspace is available in its existing read-only preview mode.
app.get('/api/config', (_req, res) => res.json({ configured: false, maxFileBytes: 20971520 }));
app.use(express.static(fileURLToPath(new URL('../frontend', import.meta.url)), { dotfiles: 'deny' }));
const port = Number(process.env.OVERVIEW_PREVIEW_PORT || 4173);
const server = app.listen(port, '127.0.0.1', () => console.log(`Survey workspace overview: http://127.0.0.1:${port}/#property-overview`));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
