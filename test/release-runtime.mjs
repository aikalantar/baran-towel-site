import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { parseHTML } from "linkedom";
import { passwordHash } from "../src/auth.js";
import { githubSimulation } from "./github-simulation.mjs";

const {repo,state} = await githubSimulation(), originalHome = await fs.readFile("public/index.html");
const canary = JSON.parse(await fs.readFile("test/fixtures/release-canary.json","utf8"));
const accounts = await Promise.all(["admin","editor"].map(async role=>{
  const salt = randomBytes(24).toString("base64");
  return {username:`fixture-${role}`,role,salt,hash:await passwordHash("fixture-runtime-password",salt)};
}));
let outbound = 0;
const mf = new Miniflare(convertV4MiniflareOptions({
  name:"builder-release-runtime",modules:true,scriptPath:".wrangler/dry-run/cms-worker.js",compatibilityDate:"2026-07-09",
  assets:{directory:"public",binding:"ASSETS",run_worker_first:["/api/cms/*"],routerConfig:{has_user_worker:true}},
  durableObjects:{CMS_GUARD:{className:"CMSLoginGuard",useSQLite:true}},
  bindings:{CMS_USERS:JSON.stringify(accounts),CMS_SESSION_SECRET:randomBytes(48).toString("base64"),CMS_GITHUB_TOKEN:"fixture-outbound-only",CMS_REPOSITORY:"fixture/isolated",CMS_BRANCH:"main"},
  outboundService:async request=>{
    outbound++;
    const url = new URL(request.url);
    assert.equal(url.origin,"https://api.github.com");
    assert.equal(request.headers.get("Authorization"),"Bearer fixture-outbound-only");
    const endpoint = url.pathname.replace("/repos/fixture/isolated/","")+url.search;
    try { return Response.json(await repo.call(endpoint,request.method,["GET","HEAD"].includes(request.method)?undefined:await request.json())); }
    catch(error) { return Response.json({message:"isolated fixture rejection"},{status:error.status || 500}); }
  },
}));
const origin = "https://luxtowelco.com", dispatch = (path,options)=>mf.dispatchFetch(origin+path,options);
const post = (body,cookie,requestOrigin=origin)=>({method:"POST",headers:{Origin:requestOrigin,"Content-Type":"application/json","X-CMS-Request":"1",...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
let passed = 0;
try {
  for (const path of ["/admin/","/admin/builder/","/admin/builder/builder.css","/admin/builder/builder.js","/admin/builder/model.js","/admin/builder/layout.js","/admin/builder/images.js","/admin/builder/image-format.js","/builder-layout.js"]) {
    const response = await dispatch(path);
    assert.equal(response.status,200);
    if(path.endsWith("/")) { assert.ok(response.headers.get("Content-Security-Policy")?.includes("script-src 'self'")); assert.ok(response.headers.get("X-Robots-Tag")?.includes("noindex")); }
  } passed++;
  const anonymous = await dispatch("/api/cms/builder");
  assert.equal(anonymous.status,401);
  assert.equal((await dispatch("/api/cms/builder/publish",post({}))).status,401); passed++;
  const cookies = {};
  for (const account of accounts) {
    const response = await dispatch("/api/cms/login",post({username:account.username,password:"fixture-runtime-password"}));
    assert.equal(response.status,200); cookies[account.role] = response.headers.get("Set-Cookie").split(";")[0];
  }
  const current = await (await dispatch("/api/cms/builder",{headers:{Cookie:cookies.admin}})).json();
  const model = current.model, paragraph = model.elements.find(e=>e.tag===canary.tag && e.anchor===canary.anchor);
  assert.ok(paragraph); const originalParagraph = paragraph.content.text; paragraph.content.text += canary.suffix;
  const body = {requestId:crypto.randomUUID(),model};
  assert.equal((await dispatch("/api/cms/builder/publish",post(body,cookies.editor))).status,403);
  assert.equal((await dispatch("/api/cms/builder/publish",post(body,cookies.admin,"https://bad.invalid"))).status,403);
  const before = state.commits.length;
  const published = await dispatch("/api/cms/builder/publish",post(body,cookies.admin)); assert.equal(published.status,200);
  assert.equal(state.commits.length,before+1);
  const output = state.files.get("public/index.html").toString();
  assert.ok(parseHTML(output).document.querySelector(`[data-builder-id="${paragraph.id}"]`).textContent.endsWith("(آزمون انتشار کنترل‌شده)")); passed++;
  assert.equal((await dispatch("/api/cms/builder/publish",post(body,cookies.admin))).status,200);
  assert.equal(state.commits.length,before+1); passed++;
  const stale = structuredClone(body); stale.requestId = crypto.randomUUID();
  assert.equal((await dispatch("/api/cms/builder/publish",post(stale,cookies.admin))).status,409); passed++;
  const fresh = await (await dispatch("/api/cms/builder",{headers:{Cookie:cookies.admin}})).json();
  const image = fresh.model.elements.find(e=>e.type==="image"); image.content.variants = [null];
  assert.equal((await dispatch("/api/cms/builder/publish",post({model:fresh.model,requestId:crypto.randomUUID()},cookies.admin))).status,400); passed++;
  const status = await (await dispatch(`/api/cms/builder/status?sha=${state.head}`,{headers:{Cookie:cookies.admin}})).json();
  assert.equal(status.commit,"committed"); assert.equal(status.deployment,"unknown"); passed++;
  const rollback = await (await dispatch("/api/cms/builder",{headers:{Cookie:cookies.admin}})).json();
  rollback.model.elements.find(e=>e.id===paragraph.id).content.text = originalParagraph;
  assert.equal((await dispatch("/api/cms/builder/publish",post({model:rollback.model,requestId:crypto.randomUUID()},cookies.admin))).status,200);
  assert.equal(parseHTML(state.files.get("public/index.html").toString()).document.querySelector(`[data-builder-id="${paragraph.id}"]`).textContent,originalParagraph); passed++;
  assert.ok((await fs.readFile("public/index.html")).equals(originalHome));
  console.log(JSON.stringify({passed,runtime:"workerd + real static assets + authenticated GitHub protocol simulation",outboundRequests:outbound,externalNetworkRequests:0,productionChanged:false}));
} finally { await mf.dispose(); }
