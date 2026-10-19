// Provider credentials and raw responses stay on the Worker. Only explicit,
// same-commit, active-production evidence may produce deployment=success.
import {SITE} from './content.js';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export async function cloudflareDeployment(env,sha,repository,branch) {
  const account=env.CMS_CF_ACCOUNT_ID,worker=env.CMS_CF_WORKER_NAME,token=env.CMS_CF_API_TOKEN;
  if(!token||!/^[a-f0-9]{32}$/i.test(account||'')||!/^[a-zA-Z0-9_-]{1,63}$/.test(worker||''))return null;
  const get=async route=>{const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${route}`,{headers:{Authorization:`Bearer ${token}`},redirect:'manual',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Provider unavailable');const data=await response.json();if(data.success!==true)throw Error('Provider unavailable');return data.result;};
  const active=async()=>{const data=await get(`workers/scripts/${worker}/deployments`);return (Array.isArray(data)?data:data?.deployments||[]).filter(d=>Number.isFinite(Date.parse(d?.created_on))).sort((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on))[0];};
  try {
    const [deployment,domains]=await Promise.all([active(),get('workers/domains')]),versions=deployment?.versions;
    if(!Array.isArray(domains)||!domains.some(d=>d.hostname===new URL(SITE).hostname&&d.service===worker&&d.environment==='production'))return {reason:'production_domain_not_verified'};
    if(!Array.isArray(versions)||versions.length!==1||versions[0].percentage!==100||!uuid.test(versions[0].version_id||''))return {reason:'production_not_single_version'};
    const version=versions[0].version_id,data=await get(`builds/builds?version_ids=${encodeURIComponent(version)}`),build=data?.builds?.[version],meta=build?.build_trigger_metadata;
    const [owner,name]=repository.split('/');
    if(!build||meta?.commit_hash!==sha||meta.branch!==branch||meta.provider_type!=='github'||meta.provider_account_name?.toLowerCase()!==owner.toLowerCase()||meta.repo_name!==name||build.pull_request||meta.build_trigger_source==='pull_request')return {reason:'active_version_not_linked_to_commit'};
    if(build.build_outcome!=='success')return {reason:'provider_build_not_successful'};
    const again=await active();
    if(again?.id!==deployment.id||JSON.stringify(again.versions)!==JSON.stringify(versions))return {reason:'production_changed_during_check'};
    return {deployment:'success',stage:'deployment_verified',evidence:'cloudflare-active-production-version',version,traffic:100};
  }catch{return {reason:'provider_verification_unavailable'};}
}

export function providerURL(value) {
  try{const url=new URL(value);return url.protocol==='https:'&&['dash.cloudflare.com','github.com'].includes(url.hostname)&&!url.username&&!url.password&&!url.search?url.href:null;}catch{return null;}
}
