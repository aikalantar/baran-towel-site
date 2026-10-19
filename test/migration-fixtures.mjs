// Real V1 fixtures come from the confirmed pre-V2 production checkpoint.
// Only public HTML and Builder source are read; no private configuration.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
const exec=promisify(execFile),checkpoint='06dc5b37a54916c0d19c14496f677f58bb761ea9';
const git=async file=>(await exec('git',['show',checkpoint+':'+file],{maxBuffer:8_000_000,encoding:'utf8'})).stdout;
const dataModule=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const fileModule=file=>pathToFileURL(path.resolve(file)).href;
const v1ModelSource=await git('public/admin/builder/model.js');
// If the local backup is available, verify it is the same real legacy model.
try{const backup=await fs.readFile('.cms-local/task5-baseline/model-v1.js','utf8');if(backup.replace(/\r\n/g,'\n')!==v1ModelSource.replace(/\r\n/g,'\n'))throw Error('Legacy model checkpoint differs from preserved backup');}catch(error){if(error.code!=='ENOENT')throw error;}
export const v1=await import(dataModule(v1ModelSource));
const oldSource=(await git('src/builder.js'))
 .replace('"linkedom"',JSON.stringify(import.meta.resolve('linkedom')))
 .replace('"./content.js"',JSON.stringify(fileModule('src/content.js')))
 .replace('"../public/admin/builder/model.js"',JSON.stringify(dataModule(v1ModelSource)))
 .replace('"../public/admin/builder/layout.js"',JSON.stringify(dataModule(await git('public/admin/builder/layout.js'))))
 .replace('"./auth.js"',JSON.stringify(fileModule('src/auth.js')))
 .replace('"./builder-images.js"',JSON.stringify(fileModule('src/builder-images.js')));
export const oldBuilder=await import(dataModule(oldSource));
export const publicPaths=(await exec('git',['ls-tree','-r','--name-only',checkpoint,'public'],{encoding:'utf8'})).stdout.trim().split(/\r?\n/).filter(p=>/^public\/(?:[a-z0-9-]+\/)*index\.html$/.test(p)&&!p.startsWith('public/admin/'));
export const realPages=await Promise.all(publicPaths.map(async file=>({path:file,html:await git(file)})));
export {checkpoint};
