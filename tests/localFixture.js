import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initLocalClients as initialize } from '../backend/src/services/localDatabase.js';
import { hashPassword } from '../backend/src/services/localSecurity.js';
export async function initLocalClients(config){
  const directory=await mkdtemp(path.resolve('artifacts/test-'));
  const clients=await initialize({...config,databaseUrl:'',localDatabaseFile:path.join(directory,'database.tar.gz'),storageDirectory:path.join(directory,'storage')});
  const users=[
    ['007','dna.callus@gmail.com','dna.suresh123','admin'],
    ['003','reviewer@dnassets.com','reviewer123','reviewer'],
    ['008','user@dnassets.com','user123','user'],
    ['004','viewer@dnassets.com','viewer123','viewer']
  ];
  for(const [suffix,email,password,role] of users){
    const id='10000000-0000-4000-8000-000000000'+suffix;
    await clients.dbInstance.query('insert into auth.users(id,email,password) values($1,$2,$3)',[id,email,await hashPassword(password)]);
    await clients.dbInstance.query('update profiles set role=$1,full_name=$2 where id=$3',[role,role,id]);
    await clients.dbInstance.query("insert into property_members(property_id,user_id)values('21610000-0000-4000-8000-000000000001',$1)",[id]);
  }
  clients.mailer={enabled:false};
  const close=clients.dbInstance.close.bind(clients.dbInstance);
  clients.dbInstance.close=async()=>{await clients.flush();await close();await rm(directory,{recursive:true,force:true});};
  return clients;
}
