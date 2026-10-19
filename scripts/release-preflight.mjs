import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { readLocalSecrets } from "./local-secrets.mjs";
import { redactRecord, writeAuditReport } from "./audit-redact.mjs";

// Wrangler does not guarantee deployment-list order. Never use an old version
// as the current rollback baseline merely because it is the first array entry.
export function latestDeployment(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.deployments) ? data.deployments : [];
  return list.filter(entry => typeof entry?.created_on === "string" && Number.isFinite(Date.parse(entry.created_on)))
    .sort((a,b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0] || null;
}

export async function runPreflight(argv = process.argv.slice(2)) {
const exec = promisify(execFile), root = process.cwd(), directory = path.resolve(".cms-local/preflight");
await fs.mkdir(directory,{recursive:true});
const config = JSON.parse((await fs.readFile("wrangler.jsonc","utf8")).replace(/^\s*\/\/.*$/gm,"").replace(/,\s*([}\]])/g,"$1"));
const credentials = await readLocalSecrets(root), report = {local:{},remote:{checked:false},readOnly:true};
const references = {workerName:config.name,repository:config.vars.CMS_REPOSITORY,branch:config.vars.CMS_BRANCH};

// Validate actual local values only in memory. Nothing raw reaches an export.
const canary = {files:credentials.files.map(f=>({snapshot:f.raw,config:f.config})),unlabelled:credentials.values.map(value=>`prefix ${value} suffix`)};
const redacted = JSON.stringify(redactRecord(canary,"",new WeakSet(),credentials.values));
const leaked = credentials.values.some(value=>[value,JSON.stringify(value).slice(1,-1),encodeURIComponent(value)].some(form=>form.length>=3 && redacted.includes(form)));
report.local.secretFilesPresent = credentials.files.length;
report.local.redactionVerifiedWithActualValues = credentials.files.length > 0 && !leaked;
if (!leaked) await writeAuditReport(path.join(directory,"redaction-canary.json"),canary);
let accounts = [];
try { accounts = JSON.parse(credentials.config.CMS_USERS || "[]"); } catch {}
report.local.credentialsWellFormed = !!credentials.config.CMS_GITHUB_TOKEN && String(credentials.config.CMS_SESSION_SECRET || "").length >= 40 && accounts.length > 0 && accounts.every(a=>["admin","editor"].includes(a.role) && typeof a.hash === "string" && Buffer.from(a.hash,"base64").length === 32 && Buffer.from(a.salt || "","base64").length >= 16);
report.local.accounts = {admins:accounts.filter(a=>a.role==="admin").length,editors:accounts.filter(a=>a.role==="editor").length};
report.local.localFilesConsistent = credentials.files.length < 2 || ["CMS_USERS","CMS_SESSION_SECRET","CMS_GITHUB_TOKEN"].every(key=>credentials.files.every(f=>f.config[key]===credentials.files[0].config[key]));
report.local.workerAndAssets = config.main === "src/cms-worker.js" && config.assets.directory === "./public" && config.assets.binding === "ASSETS" && config.assets.run_worker_first.includes("/api/cms/*");
report.local.guardBinding = config.durable_objects.bindings.some(b=>b.name === "CMS_GUARD" && b.class_name === "CMSLoginGuard");
report.local.requiredAssetsPresent = (await Promise.all(["public/admin/builder/index.html","public/admin/builder/builder.js","public/admin/builder/model.js","public/admin/builder/layout.js","public/admin/builder/schema.js","public/admin/builder/layout-v2.js","public/admin/builder/blocks.js","public/admin/builder/canvas.js","public/admin/builder/locks.js","public/admin/builder/pages-ui.js","public/admin/builder/pro-controls.js","public/admin/builder/pro.css","public/admin/builder/images.js","public/admin/builder/image-format.js","public/builder-layout.js","public/builder-blocks.js"].map(f=>fs.access(f).then(()=>true,()=>false)))).every(Boolean);
const publicText = [];
const inspectPublic = async folder => { for(const entry of await fs.readdir(folder,{withFileTypes:true})) { const file = path.join(folder,entry.name); if(entry.isDirectory()) await inspectPublic(file); else if(/\.(?:html|css|js|json|xml|txt|webmanifest)$/.test(file)) publicText.push(await fs.readFile(file,"utf8")); } };
await inspectPublic("public");
try { publicText.push(await fs.readFile(".wrangler/dry-run/cms-worker.js","utf8")); } catch {}
report.local.deployableActualCredentialsAbsent = !credentials.values.some(value=>value.length>=8 && publicText.some(source=>source.includes(value)));
const remoteURL = (await exec("git",["remote","get-url","origin"])).stdout.trim();
report.local.repositoryMatchesRemote = remoteURL === `https://github.com/${config.vars.CMS_REPOSITORY}.git`;
report.local.ignoredPrivateFiles = (await exec("git",["check-ignore",".cms-local",".dev.vars"])).stdout.split(/\r?\n/).filter(Boolean).length === 2;
const stagedNames = (await exec("git",["diff","--cached","--name-only"])).stdout.trim().split(/\r?\n/).filter(Boolean);
report.local.stagedPrivatePathsAbsent = !stagedNames.some(f=>/(?:^|\/)(?:\.cms-local|\.dev\.vars|\.env|secrets\.json|screenshots|test-results|\.wrangler)(?:\/|$|\.)|\.log$/i.test(f));
const staged = (await exec("git",["diff","--cached","--no-ext-diff"],{maxBuffer:12*1024*1024})).stdout;
report.local.stagedActualCredentialsAbsent = !credentials.values.some(value=>value.length>=8 && staged.includes(value));

if (argv.includes("--verify-remote")) {
  report.remote.checked = true;
  const token = credentials.config.CMS_GITHUB_TOKEN;
  const gh = async endpoint => {
    try {
      const response = await fetch(`https://api.github.com/${endpoint}`,{headers:{Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"Baran-Release-Preflight"},signal:AbortSignal.timeout(25000)});
      return {status:response.status,data:await response.json()};
    } catch { return {status:0}; }
  };
  const repository = config.vars.CMS_REPOSITORY, branch = config.vars.CMS_BRANCH;
  const [identity,repositoryInfo,ref,contents,deployments] = token ? await Promise.all([gh("user"),gh(`repos/${repository}`),gh(`repos/${repository}/git/ref/heads/${branch}`),gh(`repos/${repository}/contents/public/index.html?ref=${encodeURIComponent(branch)}`),gh(`repos/${repository}/deployments?per_page=5`)]) : [];
  report.remote.github = {
    authenticated:identity?.status === 200,repositoryReadable:repositoryInfo?.status === 200,branchReadable:ref?.status === 200,homepageReadable:contents?.status === 200,
    accountHasPushRole:repositoryInfo?.data?.permissions?.push === true,
    tokenContentsWrite:"requires-authorized-canary",deploymentReadAvailable:deployments?.status === 200,
  };
  if (/^[a-f0-9]{40}$/.test(ref?.data?.object?.sha || "")) references.gitHead = ref.data.object.sha;
  if (references.gitHead) {
    const checks = await gh(`repos/${repository}/commits/${references.gitHead}/check-runs`);
    report.remote.github.cloudflareBuildCheckPresent = checks.status === 200 && checks.data?.check_runs?.some(check=>["cloudflare-workers-and-pages","cloudflare-pages"].includes(check.app?.slug)) === true;
  }
  if (contents?.status === 200 && contents.data.encoding === "base64") await fs.writeFile(path.join(directory,"online-home-before.html"),Buffer.from(contents.data.content,"base64"));
  const wrangler = async args => {
    try {
      const result = await exec(process.execPath,["node_modules/wrangler/bin/wrangler.js",...args],{cwd:root,timeout:45000,maxBuffer:2*1024*1024,env:{...process.env,WRANGLER_SEND_METRICS:"false"}});
      return {ok:true,data:JSON.parse(result.stdout)};
    } catch { return {ok:false}; }
  };
  const who = await wrangler(["whoami","--json"]);
  const [deploymentList,secretList] = who.ok ? await Promise.all([wrangler(["deployments","list","--json"]),wrangler(["secret","list","--format","json"])]) : [{ok:false},{ok:false}];
  const bindings = Array.isArray(secretList.data) ? secretList.data.map(s=>s.name) : [];
  report.remote.cloudflare = {
    authenticated:who.ok,configuredAccountAccessible:who.ok && JSON.stringify(who.data).includes(config.account_id),workerDeploymentsReadable:deploymentList.ok,
    requiredSecretNamesPresent:secretList.ok && ["CMS_USERS","CMS_SESSION_SECRET","CMS_GITHUB_TOKEN"].every(name=>bindings.includes(name)),
  };
  const latest = latestDeployment(deploymentList.data);
  if (latest?.versions?.length === 1 && latest.versions[0].percentage === 100 && /^[a-f0-9-]{36}$/.test(latest.versions[0].version_id || "")) references.workerVersion = latest.versions[0].version_id;
  report.remote.cloudflare.singleVersionRollbackReferenceSaved = !!references.workerVersion;
  try {
    const response = await fetch("https://luxtowelco.com/api/cms/session",{signal:AbortSignal.timeout(20000)}), session = await response.json();
    report.remote.liveCMS = {sessionEndpoint:response.status,configured:session.configured === true,anonymousUserBlocked:session.user === null};
  } catch { report.remote.liveCMS = {reachable:false}; }
}
if (report.remote.checked) await fs.writeFile(path.join(directory,"references.json"),JSON.stringify(references,null,2)+"\n",{mode:0o600});
await writeAuditReport(path.join(directory,report.remote.checked?"environment-report.json":"staging-report.json"),report);
console.log(JSON.stringify(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runPreflight();
