import {SITE} from './content.js';

const page=/^public\/(?!admin\/)(?:[a-z0-9-]+\/)*index\.html$/;
const asset=/^public\/assets\/uploads\/[a-f0-9]{64}\.(?:webp|png|jpg)$/;
const derived=new Set(['public/builder-pages.json','public/sitemap.xml']);
const supported=path=>page.test(path)||asset.test(path)||derived.has(path);
const shaPattern=/^[a-f0-9]{40}$/;
const encoder=new TextEncoder();
async function blobSHA(response){
  if(Number(response.headers.get('content-length'))>8*1024*1024)throw Error('Oversized asset');
  const reader=response.body?.getReader();if(!reader)throw Error('Empty response');
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1024*1024)throw Error('Oversized asset');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const prefix=encoder.encode(`blob ${size}\0`),bytes=new Uint8Array(prefix.length+size);bytes.set(prefix);let offset=prefix.length;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}

// This proves publication of the committed public content, not an inferred
// Cloudflare version ID. Every changed artifact is read independently over the
// canonical public HTTPS origin, without cookies, tokens or version overrides.
export async function publicPublicationProof(repo,sha,{path,canReadPage=()=>true}={}){
  if(repo.publicOrigin&&repo.publicOrigin!==SITE)return {reason:'publication_site_not_verified'};
  let commit;
  try{commit=await repo.call(`commits/${sha}?per_page=100`);}catch{return {reason:'publication_manifest_unavailable'};}
  let files=commit?.files;
  if(commit?.sha!==sha||commit.parents?.length!==1||!/^content: /.test(commit.commit?.message||'')||!Array.isArray(files)||!files.length||files.length>64||files.some(f=>!supported(f.filename)||!['added','modified','removed'].includes(f.status)||!shaPattern.test(f.sha||''))||!files.some(f=>page.test(f.filename)))return {reason:'publication_manifest_unsupported'};
  if(files.some(f=>page.test(f.filename)&&!canReadPage(f.filename)))return {reason:'publication_scope_denied'};
  if(path){
    if(!page.test(path)||!canReadPage(path))return {reason:'publication_scope_denied'};
    if(!files.some(f=>f.filename===path)){
      // An idempotent lost-response retry may return a newer HEAD that changed
      // another page. Verify the requested page at that HEAD too, not just the
      // newest commit's unrelated artifacts, and never invent a publication SHA.
      let file;try{file=await repo.call(`contents/${path}?ref=${sha}`);}catch{return {reason:'page_not_in_publication'};}
      if(file?.type!=='file'||file.path!==path||!shaPattern.test(file.sha||'')||files.length>=64)return {reason:'page_not_in_publication'};
      files=[...files,{filename:path,status:'modified',sha:file.sha}];
    }
  }
  const deadline=AbortSignal.timeout(12000),nonce=crypto.randomUUID();
  try{
    for(let index=0;index<files.length;index+=3){
      const checked=await Promise.all(files.slice(index,index+3).map(async file=>{
        const route='/'+file.filename.slice(7).replace(/index\.html$/,''),url=new URL(route,SITE);
        url.searchParams.set('cms-publication',sha+'-'+nonce);
        const response=await fetch(url.href,{method:'GET',redirect:'manual',headers:{'Cache-Control':'no-cache',Accept:'*/*'},cf:{cacheTtl:0},signal:deadline});
        if(file.status==='removed'){await response.body?.cancel();return [404,410].includes(response.status);}
        if(response.status!==200){await response.body?.cancel();return false;}
        return await blobSHA(response)===file.sha;
      }));
      if(checked.some(value=>!value))return {reason:'public_artifacts_not_current'};
    }
    return {deployment:'success',stage:'publication_verified',evidence:'public-artifacts-match-commit',artifacts:files.length};
  }catch{return {reason:'public_verification_unavailable'};}
}
