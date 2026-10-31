import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
async function walk(root){const entries=await readdir(root,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?walk(path.join(root,e.name)):[path.join(root,e.name)]))).flat();}
const files=(await Promise.all(['backend/src','frontend/js','scripts','tests'].map(walk))).flat().filter(f=>/\.m?js$/.test(f));
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
console.log(`Syntax checked ${files.length} JavaScript files.`);
