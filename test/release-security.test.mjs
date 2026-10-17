import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { builderPage, publishBuilder } from "../src/builder.js";
import { clone } from "../public/admin/builder/model.js";
import { githubSimulation } from "./github-simulation.mjs";
import { readLocalSecrets } from "../scripts/local-secrets.mjs";
import { redactRecord } from "../scripts/audit-redact.mjs";
import { passwordHash, login, session, bytes64 } from "../src/auth.js";
import { latestDeployment } from "../scripts/release-preflight.mjs";

test("rollback baseline follows created_on rather than Wrangler deployment array order",()=>{
  const older = {created_on:"2026-08-01T10:00:00.000Z",versions:[{version_id:"11111111-1111-4111-8111-111111111111",percentage:100}]};
  const current = {created_on:"2026-10-16T10:00:00.000Z",versions:[{version_id:"22222222-2222-4222-8222-222222222222",percentage:100}]};
  const invalid = {created_on:"invalid",versions:older.versions};
  const oldestFirst = [older,invalid,current];
  assert.equal(latestDeployment(oldestFirst),current);
  assert.equal(latestDeployment([current,older]),current);
  assert.equal(latestDeployment({deployments:oldestFirst}),current);
  assert.deepEqual(oldestFirst,[older,invalid,current],"Selection must not reorder the CLI evidence");
  assert.equal(latestDeployment({deployments:"invalid"}),null);
  assert.equal(latestDeployment([invalid,{},null]),null);
  // A current split deployment must not fall back to an older single version.
  const split = {created_on:"2026-10-17T10:00:00.000Z",versions:[{version_id:"33333333-3333-4333-8333-333333333333",percentage:50},{version_id:"22222222-2222-4222-8222-222222222222",percentage:50}]};
  assert.equal(latestDeployment([older,split,current]),split);
});

test("published text cannot create scripts, event handlers or style breakouts", async()=>{
  const {repo,state} = await githubSimulation(), file = await repo.read("public/index.html"), model = builderPage(file.content,file.sha).model;
  const text = model.elements.find(e=>e.tag==="p"), attack = '</style><script src="https://bad.invalid/x.js">bad()</script><img src=x onerror=bad()>';
  text.content.text = attack;
  const before = parseHTML(file.content).document.querySelectorAll("script").length;
  await publishBuilder(repo,{model,requestId:crypto.randomUUID()},{username:"fixture-admin",role:"admin"},false);
  const doc = parseHTML(state.files.get("public/index.html").toString()).document;
  assert.equal(doc.querySelector(`[data-builder-id="${text.id}"]`).textContent,attack);
  assert.equal(doc.querySelectorAll('script[src="https://bad.invalid/x.js"],img[onerror]').length,0);
  assert.equal(doc.querySelectorAll("script").length,before+2); // trusted runtime + inert state JSON
});
test("unsafe CSS, IDs, URLs, malformed variants and safe-path escapes never write files",async()=>{
  const {repo,state} = await githubSimulation(), file = await repo.read("public/index.html"), base = builderPage(file.content,file.sha).model;
  for(const change of [
    m=>m.elements[0].style.color="red;}body{display:none}",
    m=>m.elements[0].style.background="url(https://bad.invalid)",
    m=>m.elements[0].id='new-a"]{color:red}',
    m=>m.elements.find(e=>e.type==="image").content.src="data:image/svg+xml;base64,PHN2Zy8+",
    m=>m.elements.find(e=>e.type==="image").content.variants=[null],
    m=>m.elements.find(e=>e.type==="image").content.src="/assets/../../.dev.vars.png",
    m=>m.elements.find(e=>e.type==="button").content.href="javascript:bad()",
    m=>m.base.path="public/admin/index.html",
    m=>m.base.path="../.dev.vars",
  ]) {
    const model = clone(base); change(model);
    await assert.rejects(()=>publishBuilder(repo,{model,requestId:crypto.randomUUID()},{username:"fixture-admin",role:"admin"},false));
  }
  assert.equal(state.commits.length,0);
});
test("rotation of the session signing secret invalidates old cookies and accepts new login",async()=>{
  const account = {username:"fixture-admin",role:"admin",salt:bytes64(crypto.getRandomValues(new Uint8Array(24)))};
  account.hash = await passwordHash("fixture-password",account.salt);
  const env = {CMS_USERS:JSON.stringify([account]),CMS_SESSION_SECRET:"fixture-original-".repeat(4),CMS_GITHUB_TOKEN:"fixture-only",CMS_GUARD:{idFromName:x=>x,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
  const request = new Request("https://luxtowelco.com/api/cms/login"), body = {username:account.username,password:"fixture-password"};
  const cookie = (await login(request,env,body)).split(";")[0], authenticated = new Request(request.url,{headers:{Cookie:cookie}});
  assert.ok(await session(authenticated,env));
  const rotated = {...env,CMS_SESSION_SECRET:"fixture-new-signing-key-".repeat(4)};
  assert.equal(await session(authenticated,rotated),null);
  const newCookie = (await login(request,rotated,body)).split(";")[0];
  assert.ok(await session(new Request(request.url,{headers:{Cookie:newCookie}}),rotated));
});
test("real local credential values are removed even from unlabelled audit fields",async()=>{
  const local = await readLocalSecrets();
  const data = {rawFiles:local.files.map(f=>f.raw),unlabelled:local.values.map(v=>`diagnostic ${v}`)};
  const safe = JSON.stringify(redactRecord(data,"",new WeakSet(),local.values));
  assert.ok(!local.values.some(value=>value.length>=3 && safe.includes(value)),"Audit output must not contain any actual local credential value");
});
