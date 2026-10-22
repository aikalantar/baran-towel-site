import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {publicPublicationProof} from '../src/publication-proof.js';
import {GitHubRepository} from '../src/github.js';
import {publicationVerified,publicationMessage,customerPublicationMessage} from '../public/admin/builder/publication-status.js';
const sha='a'.repeat(40),other='b'.repeat(40),image='public/assets/uploads/'+'c'.repeat(64)+'.webp';
const bodies=new Map([['public/index.html','<html><meta name="builder-request" content="unique"><h1>Published</h1></html>'],[image,'verified binary'],['public/sitemap.xml','<urlset>published</urlset>'],['public/builder-pages.json','{"pages":[]}']]);
const blob=value=>createHash('sha1').update('blob '+Buffer.byteLength(value)+'\0').update(value).digest('hex');
const manifest=()=>({sha,parents:[{sha:other}],commit:{message:'content: visual builder index.html (fixture)'},files:[...bodies].map(([filename,body])=>({filename,status:'modified',sha:blob(body)}))});
async function fixture({change=()=>{},response,options={},repoConfig={}}={}){
 const data=manifest();change(data);const calls=[],repo={publicOrigin:'https://luxtowelco.com',call:async()=>data,...repoConfig},original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{const u=new URL(url);calls.push({url:u.href,init});const file=u.pathname==='/'?'public/index.html':'public'+u.pathname;return response?response(file,u,init):new Response(bodies.get(file));};
 try{return{result:await publicPublicationProof(repo,sha,options),calls};}finally{globalThis.fetch=original;}
}
test('public proof independently verifies every changed HTML image registry and sitemap without provider credentials',async()=>{
 const{result,calls}=await fixture();assert.equal(result.evidence,'public-artifacts-match-commit');assert.equal(result.deployment,'success');assert.equal(result.artifacts,4);
 assert.equal(calls.length,4);for(const {url,init}of calls){assert.equal(new URL(url).origin,'https://luxtowelco.com');assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,undefined);assert.equal(init.headers.Cookie,undefined);assert.equal(init.cf.cacheTtl,0);assert.ok(new URL(url).searchParams.get('cms-publication').startsWith(sha));}
});
for(const changed of bodies.keys())test('no success when public artifact differs: '+changed,async()=>{const{result}=await fixture({response:file=>new Response(file===changed?'old content':bodies.get(file))});assert.notEqual(result.deployment,'success');assert.equal(result.reason,'public_artifacts_not_current');});
test('removed pages must really be absent, never a redirect login page or old HTML',async()=>{
 for(const status of [200,302,404,410]){const{result}=await fixture({change:data=>data.files[0].status='removed',response:file=>file==='public/index.html'?new Response('absent',{status}):new Response(bodies.get(file))});assert.equal(result.deployment==='success',[404,410].includes(status));}
});
for(const [name,change]of[
 ['code changes',m=>m.files.push({filename:'src/cms-worker.js',status:'modified',sha:other})],
 ['private path',m=>m.files[0].filename='public/../.dev.vars'],
 ['foreign URL',m=>m.files[0].filename='https://evil.invalid/file'],
 ['untrusted commit',m=>m.sha=other],['merge commit',m=>m.parents.push({sha})],['non-content commit',m=>m.commit.message='build success'],
 ['truncated/large manifest',m=>m.files=Array(100).fill(m.files[0])],['rename',m=>m.files[0].status='renamed'],['invalid blob',m=>m.files[0].sha='invalid'],['no page',m=>m.files=m.files.filter(f=>!f.filename.endsWith('.html'))]
])test('unsupported manifest fails closed without public requests: '+name,async()=>{const{result,calls}=await fixture({change});assert.notEqual(result.deployment,'success');assert.equal(calls.length,0);});
test('page ownership site and requested-publication scope are enforced before public verification',async()=>{
 for(const input of[{options:{canReadPage:()=>false}},{options:{path:'public/catalog/index.html'}},{repoConfig:{publicOrigin:'https://another.example'}}]){const{result,calls}=await fixture(input);assert.notEqual(result.deployment,'success');assert.equal(calls.length,0);}
});
test('network failures redirects and oversized bodies can never produce success',async()=>{
 for(const response of[()=>{throw Error('network offline');},()=>new Response('login',{status:302}),()=>new Response('large',{headers:{'content-length':String(9*1024*1024)}})]){const{result}=await fixture({response});assert.notEqual(result.deployment,'success');}
});
test('a lost-response replay can verify its unchanged requested page at a newer current HEAD',async()=>{
 const path='public/catalog/index.html',body='<h1>Previously published request receipt</h1>',original=globalThis.fetch,calls=[];
 const repo={call:async endpoint=>endpoint.startsWith('commits/')?manifest():{type:'file',path,sha:blob(body)}};
 globalThis.fetch=async url=>{const u=new URL(url);calls.push(u.pathname);return new Response(u.pathname==='/catalog/'?body:bodies.get(u.pathname==='/'?'public/index.html':'public'+u.pathname));};
 try{const result=await publicPublicationProof(repo,sha,{path});assert.equal(result.deployment,'success');assert.equal(result.artifacts,5);assert.ok(calls.includes('/catalog/'));}finally{globalThis.fetch=original;}
});
test('replayed publication cannot confirm if its requested page is still old online or out of scope',async()=>{
 const path='public/catalog/index.html',original=globalThis.fetch,repo={call:async endpoint=>endpoint.startsWith('commits/')?manifest():{type:'file',path,sha:blob('new receipt')}};
 globalThis.fetch=async url=>{const u=new URL(url);return new Response(u.pathname==='/catalog/'?'old receipt':bodies.get(u.pathname==='/'?'public/index.html':'public'+u.pathname));};
 try{assert.notEqual((await publicPublicationProof(repo,sha,{path})).deployment,'success');assert.equal((await publicPublicationProof(repo,sha,{path,canReadPage:p=>p!==path})).reason,'publication_scope_denied');}finally{globalThis.fetch=original;}
});
async function repositoryCase({race=false,provider=false,publicMatch=true,manifestAvailable=true}={}){
 const repo=new GitHubRepository({CMS_REPOSITORY:'fixture/repo',CMS_BRANCH:'main',CMS_GITHUB_TOKEN:'private-repository-token',...(provider?{CMS_CF_ACCOUNT_ID:'d'.repeat(32),CMS_CF_WORKER_NAME:'fixture',CMS_CF_API_TOKEN:'private-provider-token'}:{})}),calls=[];let heads=0;
 repo.call=async endpoint=>{calls.push(endpoint);if(endpoint.startsWith('git/commits/'))return{sha};if(endpoint.startsWith('git/ref/'))return{object:{sha:race&&heads++?other:sha}};if(endpoint.startsWith('deployments?'))return[];if(endpoint.startsWith('commits/')){if(!manifestAvailable)throw Error('unavailable');return manifest();}throw Error('unexpected endpoint');};
 const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{const u=new URL(url);if(u.hostname==='api.cloudflare.com')return new Response('{}',{status:403});assert.equal(init.headers.Authorization,undefined);const file=u.pathname==='/'?'public/index.html':'public'+u.pathname;return new Response(publicMatch?bodies.get(file):'old content');};
 try{return{result:await repo.publicationStatus(sha,{path:'public/index.html'}),calls};}finally{globalThis.fetch=original;}
}
test('production configuration without CF credentials or GitHub Deployment records still confirms proven publication',async()=>{const{result}=await repositoryCase();assert.equal(result.commit,'committed');assert.equal(result.evidence,'public-artifacts-match-commit');assert.equal(result.deployment,'success');assert.doesNotMatch(JSON.stringify(result),/private-/);});
test('unavailable optional provider does not prevent independent content verification',async()=>{assert.equal((await repositoryCase({provider:true})).result.deployment,'success');});
test('head advancement during independent verification cannot confirm a stale publication as current',async()=>{const{result}=await repositoryCase({race:true});assert.equal(result.deployment,'superseded');assert.equal(result.evidence,null);});
test('generic build success without a complete manifest or matching public content remains unverified',async()=>{for(const input of[{publicMatch:false},{manifestAvailable:false}])assert.notEqual((await repositoryCase(input)).result.deployment,'success');});
test('both interfaces share the proof allowlist and distinguish verified content from a provider version',()=>{
 const proof={commit:'committed',deployment:'success',evidence:'public-artifacts-match-commit'};assert.equal(publicationVerified(proof),true);assert.match(customerPublicationMessage(proof),/انتشار آنلاین تأیید شد/);assert.match(publicationMessage(proof),/همهٔ فایل/);assert.doesNotMatch(publicationMessage(proof),/شناسهٔ نسخه/);
 for(const input of[{deployment:'success'},{deployment:'success',evidence:'generic-build-success'}])assert.equal(publicationVerified(input),false);
 assert.match(customerPublicationMessage({deployment:'superseded'}),/نسخهٔ جدیدتری/);assert.doesNotMatch(customerPublicationMessage({deployment:'superseded'}),/هنوز تأیید نشده/);
});
