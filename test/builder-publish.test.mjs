import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parseHTML } from "linkedom";
import { builderPage, publishBuilder } from "../src/builder.js";
import { clone, History, encodeDraft, decodeDraft } from "../public/admin/builder/model.js";
import { githubSimulation } from "./github-simulation.mjs";
import { GitHubRepository } from "../src/github.js";
import { handleCMS } from "../src/cms-worker.js";
import { login, passwordHash, bytes64 } from "../src/auth.js";
import { redactRecord, redactText } from "../scripts/audit-redact.mjs";

const admin = {username:"fixture-admin",role:"admin"};
const pageFor = async (repo,path = "public/index.html") => { const file = await repo.read(path); return builderPage(file.content,file.sha,path); };
const payload = model => ({model,requestId:crypto.randomUUID()});

test("publishing uses real GitHub tree/commit/CAS protocol atomically and preserves SEO/scripts", async () => {
  const {repo,state} = await githubSimulation(), base = await pageFor(repo), model = clone(base.model);
  const title = model.elements.find(e => e.tag === "h1"); title.content.text = "عنوان منتشرشده آزمایشی"; title.layouts.desktop = {x:3,y:-2,width:55,height:15}; title.layouts.mobile = {x:1,y:0,width:80,height:12};
  const target = model.elements.find(e => e.type === "image" && e.content.src.includes("home/baran-hero.webp"));
  target.content = {src:"data:image/png;base64," + (await fs.readFile("public/favicon-32x32-v2.png")).toString("base64"),alt:"تصویر منتشرشده",variants:[{src:"data:image/png;base64,"+(await fs.readFile("public/favicon-16x16-v2.png")).toString("base64"),width:16,height:16}]};
  const moved = model.elements.find(e => e.tag === "h2" && e.anchor !== title.anchor && e.movable); moved.anchor = title.anchor; moved.parentId=title.anchor;moved.free = true; moved.layouts.desktop = {x:10,y:25,width:60,height:20}; moved.order = 2;
  const added = {id:"new-fixture-added",type:"button",tag:"a",anchor:title.anchor,parentId:title.anchor,source:null,content:{text:"دکمه واقعی",href:"/catalog/"},layouts:{desktop:{x:5,y:10,width:20,height:10},tablet:{},mobile:{x:5,y:10,width:70,height:10}},style:{color:"#ffffff",fontSize:18},z:10,deleted:false};
  model.elements.push(added);
  const deleted = model.elements.find(e => e.tag === "figcaption"); deleted.deleted = true;
  const request = payload(model), response = await publishBuilder(repo,request,admin,false);
  assert.equal(response.publication.commit,"committed"); assert.equal(response.publication.deployment,"unknown");
  assert.equal(state.commits.length,1);
  const output = state.files.get("public/index.html").toString(), doc = parseHTML(output).document, original = parseHTML((await fs.readFile("public/index.html","utf8"))).document;
  assert.equal(doc.querySelector("h1").textContent,title.content.text);
  assert.equal(doc.querySelector(`[data-builder-id="${moved.id}"]`).parentElement.getAttribute("data-builder-anchor"),title.anchor);
  assert.equal(doc.querySelector(`[data-builder-id="${added.id}"]`).textContent,"دکمه واقعی");
  assert.equal(doc.querySelector(`[data-builder-id="${deleted.id}"]`),null);
  for (const selector of ["title",'meta[name="description"]','link[rel="canonical"]','link[rel="alternate"]']) assert.equal(doc.querySelector(selector).outerHTML,original.querySelector(selector).outerHTML);
  assert.equal(doc.querySelector('script[src="/script.df5cebe557.js"]').outerHTML,original.querySelector('script[src="/script.df5cebe557.js"]').outerHTML);
  assert.doesNotThrow(()=>JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent));
  const img = doc.querySelector(`[data-builder-id="${target.id}"]`);
  assert.equal(img.getAttribute("loading"),"eager"); assert.equal(img.getAttribute("fetchpriority"),"high"); assert.equal(img.getAttribute("width"),"32");
  assert.ok(img.getAttribute("srcset").includes("16w")); assert.ok(img.getAttribute("srcset").includes("32w"));
  assert.equal(doc.querySelector('link[rel="preload"][as="image"]').getAttribute("href"),img.getAttribute("src"));
  assert.ok(state.files.has("public"+img.getAttribute("src")));
  assert.equal(state.files.has("public"+img.getAttribute("src")),true);
  const rules = doc.querySelector("#builder-layout").textContent; assert.ok(rules.includes("@media(max-width:640px)")); assert.ok(rules.includes("0.55"));
  const reloaded = await pageFor(repo); assert.ok(reloaded.model.elements.some(e => e.id === added.id)); assert.ok(reloaded.model.elements.some(e => e.id === title.id));
  assert.equal(reloaded.model.elements.find(e => e.id === moved.id).anchor,title.anchor);
  const replay = await publishBuilder(repo,request,admin,false); assert.equal(replay.replayed,true); assert.equal(state.commits.length,1);
});

test("conflicts, invalid models, missing images, spoofed uploads and GitHub failure preserve original files", async () => {
  for (const scenario of ["stale","selector","missing","svg","dimensions","network","race"]) {
    const {repo,state} = await githubSimulation(), page = await pageFor(repo), model = clone(page.model), original = state.files.get("public/index.html");
    const image = model.elements.find(e => e.type === "image");
    if (scenario === "stale") model.base.revision = "stale";
    if (scenario === "selector") model.elements[0].source.selector = "body";
    if (scenario === "missing") image.content.src = "/assets/missing.png";
    if (scenario === "svg") image.content.src = "data:image/png;base64,"+Buffer.from("<svg onload='bad()'></svg>").toString("base64");
    if (scenario === "dimensions") image.content.src = "data:image/png;base64,"+Buffer.alloc(40).toString("base64");
    if (scenario === "network") state.fail = true;
    if (scenario === "race") state.race = true;
    await assert.rejects(()=>publishBuilder(repo,payload(model),admin,false));
    assert.ok(state.files.get("public/index.html").equals(original));
  }
});

test("all nine pages retain language/SEO and can be edited generically; historical restore is revision checked", async () => {
  const {repo,state} = await githubSimulation(), firstHead = state.head;
  const paths = [...state.files.keys()].filter(p => p.endsWith("/index.html") && !p.startsWith("public/admin/"));
  assert.equal(paths.length,9);
  for (const path of paths) {
    const page = await pageFor(repo,path), model = clone(page.model), title = model.elements.find(e => e.tag === "h1");
    assert.ok(title,`editable heading: ${path}`); title.content.text += " test";
    const before = parseHTML(state.files.get(path).toString()).document;
    await publishBuilder(repo,payload(model),admin,false);
    const after = parseHTML(state.files.get(path).toString()).document;
    assert.equal(after.documentElement.getAttribute("dir"),before.documentElement.getAttribute("dir"));
    assert.equal(after.documentElement.getAttribute("lang"),before.documentElement.getAttribute("lang"));
    assert.equal(after.querySelector("title").textContent,before.querySelector("title").textContent);
  }
  const current = await repo.read("public/index.html"), old = await repo.read("public/index.html",firstHead), restore = builderPage(old.content,current.sha).model;
  restore.base.restoreCommit = firstHead;
  await publishBuilder(repo,payload(restore),admin,false);
  assert.equal(parseHTML(state.files.get("public/index.html").toString()).document.querySelector("h1").textContent,parseHTML(old.content).document.querySelector("h1").textContent);
});

test("structural operations and responsive geometry remain undoable through 120-step recovery", async () => {
  const {repo} = await githubSimulation(), page = await pageFor(repo), h = new History(page.model), target = page.model.elements.find(e => e.movable && e.type === "heading"), destination = page.anchors.find(a => a.id !== target.anchor).id;
  for (let i=0;i<120;i++) { const next = clone(h.present), e = next.elements.find(e => e.id === target.id); e.anchor = destination;e.parentId=destination; e.free = true; e.order = i; e.layouts.desktop = {x:i/10,y:5,width:40,height:10}; h.commit(next); }
  const restored = decodeDraft(encodeDraft(h),page.model,page.anchors);
  for(let i=0;i<120;i++) assert.ok(restored.undo());
  assert.equal(restored.present.elements.find(e=>e.id===target.id).anchor,target.anchor);
  for(let i=0;i<120;i++) assert.ok(restored.redo());
  assert.equal(restored.present.elements.find(e=>e.id===target.id).anchor,destination);
});

test("library image replacements retain available responsive variants and alt-only edits preserve picture optimization", async () => {
  const {repo,state} = await githubSimulation(), page = await pageFor(repo), model = clone(page.model);
  const image = model.elements.find(e=>e.content.src?.includes("home/baran-hero.webp"));
  image.content.src = "/assets/images/home/editorial-01.webp"; image.content.alt = "library replacement";
  await publishBuilder(repo,payload(model),admin,false);
  let doc = parseHTML(state.files.get("public/index.html").toString()).document;
  assert.ok(doc.querySelector(".hero-media").getAttribute("srcset").includes("editorial-01-640.webp 640w"));
  const srcset = doc.querySelector("picture source").getAttribute("srcset"), next = (await pageFor(repo)).model;
  next.elements.find(e=>e.id===image.id).content.alt = "alt only";
  await publishBuilder(repo,payload(next),admin,false);
  doc = parseHTML(state.files.get("public/index.html").toString()).document;
  assert.equal(doc.querySelector("picture source").getAttribute("srcset"),srcset);
  const protectedModel = (await pageFor(repo,"public/catalog/index.html")).model;
  const protectedElement = protectedModel.elements.find(e=>e.movable===false); assert.ok(protectedElement);
  protectedElement.free = true;
  await assert.rejects(()=>publishBuilder(repo,payload(protectedModel),admin,false));
});

test("large existing GitHub assets use the blob API when contents omits base64", async () => {
  const repo = new GitHubRepository({CMS_REPOSITORY:"fixture/repo",CMS_GITHUB_TOKEN:"fixture"});
  const bytes = await fs.readFile("public/favicon-32x32-v2.png"), calls = [];
  repo.call = async path => { calls.push(path.split("?")[0]); return path.startsWith("contents/") ? {sha:"b".repeat(40),encoding:"none",content:""} : {encoding:"base64",content:bytes.toString("base64")}; };
  assert.ok(Buffer.from(await repo.readBytes("public/fixture.png")).equals(bytes));
  assert.equal(calls.length,2); assert.ok(calls[1].startsWith("git/blobs/"));
});

test("editor content publishing succeeds; anonymous and CSRF requests are rejected", async () => {
  const {repo,state} = await githubSimulation(), page = await pageFor(repo);
  const account = {username:"fixture-editor",role:"editor",salt:bytes64(crypto.getRandomValues(new Uint8Array(24)))};
  account.hash = await passwordHash("fixture-only-password",account.salt);
  const env = {CMS_USERS:JSON.stringify([account]),CMS_SESSION_SECRET:"fixture-session-".repeat(5),CMS_GITHUB_TOKEN:"fixture",CMS_GUARD:{idFromName:id=>id,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
  const url = "https://luxtowelco.com/api/cms/builder/publish", cookie = (await login(new Request(url),env,{username:account.username,password:"fixture-only-password"})).split(";")[0];
  const request = (cookie,origin="https://luxtowelco.com") => new Request(url,{method:"POST",headers:{Origin:origin,"X-CMS-Request":"1","Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(payload(page.model))});
  assert.equal((await handleCMS(request(),env,{repo})).status,401);
  assert.equal((await handleCMS(request(cookie),env,{repo})).status,200);
  assert.equal((await handleCMS(request(cookie,"https://bad.invalid"),env,{repo})).status,403);
  assert.equal(state.commits.length,1);
});

test("deployment UI evidence is independent of commits and ignores generic checks and preview deploys", async () => {
  const repo = new GitHubRepository({CMS_REPOSITORY:"fixture/repo",CMS_GITHUB_TOKEN:"fixture"}), sha="a".repeat(40);
  for (const scenario of ["none","preview","success","failure","pending","unavailable","impostor","missing-commit","superseded","older-deployment","forged-status"]) {
    repo.call = async path => {
      if(scenario === "unavailable") throw new Error("fixture access denied");
      if(path.startsWith("git/commits/")) return {sha:scenario === "missing-commit" ? "b".repeat(40) : sha};
      if(path === "git/ref/heads/main") return {object:{sha:scenario === "superseded" ? "c".repeat(40) : sha}};
      const creator = {login:scenario === "impostor" ? "cloudflare-impostor" : "cloudflare-workers-and-pages[bot]",type:scenario === "impostor" ? "User" : "Bot"};
      if(path.startsWith("deployments?")) return scenario === "none" ? [] : [{id:1,sha:scenario === "older-deployment" ? "d".repeat(40) : sha,production_environment:scenario!=="preview",creator}];
      return [{state:scenario === "forged-status" ? "success" : scenario,creator:scenario === "forged-status" ? {login:"someone",type:"User"} : creator,log_url:"https://dash.cloudflare.com/fixture"}];
    };
    const result = await repo.publicationStatus(sha);
    assert.equal(result.deployment,scenario === "superseded" ? "superseded" : ["success","failure","pending"].includes(scenario) ? scenario : "unknown");
    assert.equal(result.commit,["unavailable","missing-commit"].includes(scenario) ? "unknown" : "committed");
  }
});

test("audit redaction removes nested credentials, serialized config, bearer cookies and token URLs", () => {
  const fixture = {password:"fixture-password",CMS_USERS:'[{"hash":"fixture-hash","salt":"fixture-salt"}]',nested:{Authorization:"Bearer fixture",safe:"good"},text:'CMS_SESSION_SECRET="fixture-secret" hash=fixture-hash https://fixture.invalid/?token=fixture-token',token:"fixture-token"};
  const safe = JSON.stringify(redactRecord(fixture));
  for(const part of ["fixture-password","fixture-hash","fixture-salt","fixture-secret","fixture-token"]) assert.equal(safe.includes(part),false);
  assert.equal(redactText("Bearer fixture-token").includes("fixture-token"),false);
  assert.equal(JSON.parse(safe).nested.safe,"good");
});
