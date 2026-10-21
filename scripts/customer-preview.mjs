// Isolated preview: even the Publish action writes only this disposable copy.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startLocal} from './cms-local.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'cms-customer-preview-'));
await fs.cp('public',path.join(root,'public'),{recursive:true});
let server;try{server=await startLocal(root,Number(process.env.PORT)||4188);}catch(e){if(!['EADDRINUSE','EACCES'].includes(e.code))throw e;server=await startLocal(root,0);}
const origin=`http://127.0.0.1:${server.address().port}`;
await fs.mkdir('.cms-local/task18-qa',{recursive:true});await fs.writeFile('.cms-local/task18-qa/preview.json',JSON.stringify({root,origin},null,2));
console.log(`Customer Editor: ${origin}/admin/editor/\nDesigner Studio: ${origin}/admin/builder/\nDisposable site: ${root}\nPublish writes only this temporary copy; no commit, push or deploy.`);
