// Run existing browser regressions against their own disposable sites and evidence directories.
// Temporary entry files stay beside tests so relative module imports remain identical.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'cms-task18-regression-'));
const suites=process.argv.slice(2).length?process.argv.slice(2):['builder-browser','freeform-browser','direct-edit-browser','task6-blocks-browser','migration-browser','identity-interop-browser','stabilization-browser'];
const results=[];
const report=process.argv.slice(2).length?`.cms-local/task18-qa/${suites.join('-')}-regression.json`:'.cms-local/task18-qa/regression.json';
await fs.mkdir('.cms-local/task18-qa',{recursive:true});
for(const suite of suites){
 const dir=path.join(root,suite);await fs.mkdir(dir,{recursive:true});
 const source=await fs.readFile(`test/${suite}.mjs`,'utf8'),temp=`test/.task18-${suite}.mjs`;
 await fs.writeFile(temp,source.replaceAll('.cms-local',dir.replaceAll('\\','/')));
 const logfile=await fs.open(path.join(dir,'run.log'),'w');
 try{console.log('RUN '+suite);const code=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[temp],{stdio:['ignore',logfile.fd,logfile.fd]});p.on('exit',resolve);p.on('error',reject);});results.push({suite,code,evidence:dir});console.log((code===0?'PASS ':'FAIL ')+suite);}
 finally{await logfile.close();await fs.unlink(temp);}
 await fs.writeFile(report,JSON.stringify({root,results},null,2));
}
if(results.some(r=>r.code!==0))process.exitCode=1;
