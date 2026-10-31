import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const frontendDir = path.join(rootDir, 'frontend');
const publicDir = path.join(rootDir, 'public');

console.log('[Build] Synchronizing frontend assets to public directory...');
fs.cpSync(frontendDir, publicDir, { recursive: true });
console.log('[Build] Frontend assets successfully synced to public directory.');

