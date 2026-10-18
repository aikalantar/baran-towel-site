import fs from 'node:fs/promises';
import path from 'node:path';
import {startLocal} from './cms-local.mjs';

// Review publication writes to a disposable copy, never to workspace public/.
const folder=path.resolve('.cms-local/task5-review');
await fs.mkdir(folder,{recursive:true});
const isolated=await fs.mkdtemp(path.join(folder,'site-'));
await fs.cp('public',path.join(isolated,'public'),{recursive:true});
const preferred=Number(process.env.BUILDER_REVIEW_PORT)||7955;
let server;
try{server=await startLocal(isolated,preferred);}
catch(error){if(!['EADDRINUSE','EACCES'].includes(error.code))throw error;server=await startLocal(isolated,0);}
console.log(`Builder review: http://127.0.0.1:${server.address().port}/admin/builder/?path=public%2Findex.html`);
console.log(`Isolated local files: ${isolated}`);
console.log('Local review publications affect this copy only. No push or deployment.');
