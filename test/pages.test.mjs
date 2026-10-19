import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {parseHTML} from "linkedom";
import {LocalRepository,startLocal} from "../scripts/cms-local.mjs";
import {generatedPagePath,preparePage,newPageSource,applyPageSEO,publicationChanges,listPages,pageAction,validatePageMetadata} from "../src/pages.js";
import {GitHubRepository} from "../src/github.js";
import {handleCMS} from "../src/cms-worker.js";
import {login,passwordHash,bytes64} from "../src/auth.js";

const admin={username:"fixture-admin",role:"admin"};
const base=path.resolve(".cms-local/page-management-tests");
async function fixture(t){
  await fs.mkdir(base,{recursive:true});
  const directory=await fs.mkdtemp(path.join(base,"case-"));
  assert.ok(directory.startsWith(base+path.sep));
  await fs.cp(path.resolve("public"),path.join(directory,"public"),{recursive:true});
  t.after(async()=>{assert.ok(directory.startsWith(base+path.sep));await fs.rm(directory,{recursive:true,force:true});});
  return {repo:new LocalRepository(directory),directory};
}
async function publishPrepared(repo,prepared,patch={}){
  const model={base:{path:prepared.path,revision:"new",creation:prepared.creation},page:{...prepared.creation.page,...patch},elements:[]};
  const head=await repo.head(),source=await newPageSource(repo,model,head),{document}=parseHTML(source.content);
  applyPageSEO(document,model);
  const html=document.toString(),changes=await publicationChanges(repo,head,model,html);
  return repo.commit(head,[{path:prepared.path,content:changes.pageHTML || html},...changes]);
}
const action=async(repo,path,operation,options={})=>pageAction(repo,{path,head:await repo.head(),action:operation,requestId:crypto.randomUUID(),...options},admin,true);

test("page creation is draft-only and a prepared page publishes to a genuine static route with SEO and sitemap",async t=>{
  const {repo}=await fixture(t),before=await repo.head(),initialPages=(await listPages(repo)).pages;
  const prepared=await preparePage(repo,{slug:"test-new-page",title:"صفحه جدید آزمون",description:"توضیح قابل ویرایش",template:"content"});
  assert.equal(await repo.head(),before);
  assert.equal(prepared.path,"public/test-new-page/index.html");
  await assert.rejects(()=>repo.read(prepared.path));
  const doc=parseHTML(prepared.content).document;
  assert.equal(doc.querySelectorAll("main h1").length,1);assert.equal(doc.querySelectorAll("main>section").length,3);
  assert.equal(doc.querySelectorAll('link[rel="alternate"]').length,0);
  await publishPrepared(repo,prepared);
  const saved=parseHTML((await repo.read(prepared.path)).content).document;
  assert.equal(saved.title,"صفحه جدید آزمون");assert.equal(saved.querySelector('meta[name="description"]').content,"توضیح قابل ویرایش");
  assert.equal(saved.querySelector('link[rel="canonical"]').href,"https://luxtowelco.com/test-new-page/");
  assert.ok((await repo.read("public/sitemap.xml")).content.includes("https://luxtowelco.com/test-new-page/"));
  const pages=await listPages(repo);assert.equal(pages.pages.length,initialPages.length+1);assert.equal(pages.pages.find(p=>p.path===prepared.path).managed,true);
  // Real production snapshots can retain deleted-page recovery records.
  // Creation must preserve those records as well as every original page.
  for(const previous of initialPages)assert.deepEqual(pages.pages.find(p=>p.path===previous.path),previous);
});

test("all templates and English page paths preserve the genuine site shell and valid language/heading metadata",async t=>{
  const {repo}=await fixture(t);
  for(const template of ["blank","hero","content"]){
    const prepared=await preparePage(repo,{slug:`english-${template}`,language:"en",title:"Actual English page",template});
    const doc=parseHTML(prepared.content).document;
    assert.equal(prepared.path,`public/en/english-${template}/index.html`);
    assert.equal(doc.documentElement.lang,"en");assert.equal(doc.documentElement.dir,"ltr");
    assert.ok(doc.querySelector("header.site-header"));assert.ok(doc.querySelector("footer"));assert.equal(doc.querySelectorAll("main h1").length,1);
    assert.ok(doc.querySelector('script[src="/script.df5cebe557.js"]'));
    if(template==="hero")assert.equal(doc.querySelector("main a").getAttribute("href"),"/en/catalog/");
  }
});

test("duplicate preserves actual content, builder geometry, styles and image metadata while assigning a new page identity",async t=>{
  const {repo}=await fixture(t),original=parseHTML((await repo.read("public/index.html")).content).document;
  const prepared=await preparePage(repo,{slug:"duplicate-fixture",kind:"duplicate",sourcePath:"public/index.html",title:"نسخه دوم"}),doc=parseHTML(prepared.content).document;
  assert.equal(doc.querySelector("main").textContent,original.querySelector("main").textContent);
  assert.equal(doc.querySelector("#builder-state").textContent,original.querySelector("#builder-state").textContent);
  assert.equal(doc.querySelector("main img").getAttribute("srcset"),original.querySelector("main img").getAttribute("srcset"));
  assert.equal(doc.querySelector('meta[name="builder-page-id"]').content,prepared.creation.id);
  assert.equal(doc.querySelector('meta[name="builder-request"]'),null);
});

test("unsafe/reserved/colliding slugs cannot overwrite routes or generated destinations",async t=>{
  const {repo}=await fixture(t);
  for(const slug of ["admin","api","en","blog","catalog","../escape","a/b","A","a?x","-leading","trail-"]){assert.throws(()=>generatedPagePath(slug));}
  const prepared=await preparePage(repo,{slug:"collision-fixture"});await publishPrepared(repo,prepared);
  await assert.rejects(()=>preparePage(repo,{slug:"collision-fixture"}),e=>e.status===409);
  await fs.mkdir(repo.file("public/collision-assets"),{recursive:true});await fs.writeFile(repo.file("public/collision-assets/image.png"),"fixture");
  await assert.rejects(()=>preparePage(repo,{slug:"collision-assets"}),e=>e.status===409);
  await assert.rejects(()=>preparePage(repo,{slug:"home"}));
});

test("generated source is pinned to its immutable local draft checkpoint and malicious descriptors are refused",async t=>{
  const {repo}=await fixture(t),prepared=await preparePage(repo,{slug:"source-pinned",title:"Pinned"}),head=await repo.head();
  const original=(await repo.read("public/index.html")).content;
  await repo.commit(head,[{path:"public/index.html",content:original.replace("<h1",'<h1 data-test="new-base"')}]);
  const model={base:{path:prepared.path,revision:"new",creation:prepared.creation}};
  assert.equal((await newPageSource(repo,model,await repo.head())).content,prepared.content);
  for(const patch of [{sourcePath:".dev.vars"},{path:"public/admin/index.html"},{sourceSha:"bogus"},{sourceRevision:"main"}]){
    const unsafe=structuredClone(model);Object.assign(unsafe.base.creation,patch);
    await assert.rejects(()=>newPageSource(repo,unsafe,repo.head()));
  }
});

test("metadata rename, visibility, sitemap and generated navigation inclusion/order are genuine file changes",async t=>{
  const {repo}=await fixture(t),first=await preparePage(repo,{slug:"menu-first",title:"اول"});await publishPrepared(repo,first);
  const second=await preparePage(repo,{slug:"menu-second",title:"دوم"});await publishPrepared(repo,second);
  await action(repo,first.path,"menu",{menu:{included:true,label:"اول در منو",order:20}});
  await action(repo,second.path,"menu",{menu:{included:true,label:"دوم در منو",order:10}});
  let doc=parseHTML((await repo.read("public/index.html")).content).document;
  assert.deepEqual([...doc.querySelectorAll(".primary-nav [data-builder-menu]")].map(a=>a.textContent),["دوم در منو","اول در منو"]);
  await action(repo,first.path,"rename",{title:"نام تازه"});
  assert.equal(parseHTML((await repo.read(first.path)).content).document.title,"نام تازه");
  await action(repo,second.path,"metadata",{page:{visibility:"unlisted",robots:"noindex",description:"متن تازه"}});
  doc=parseHTML((await repo.read(second.path)).content).document;
  assert.equal(doc.querySelector('meta[name="robots"]').content,"noindex, follow");
  assert.equal(doc.querySelector('meta[name="description"]').content,"متن تازه");
  assert.equal((await repo.read("public/sitemap.xml")).content.includes("https://luxtowelco.com/menu-second/"),false);
  assert.equal(parseHTML((await repo.read("public/index.html")).content).document.querySelector('a[href="/menu-second/"]'),null);
});

test("archive and delete remove public content and retain private/historical recovery references for exact restoration",async t=>{
  const {repo,directory}=await fixture(t),prepared=await preparePage(repo,{slug:"recover-fixture",title:"بازیابی"});await publishPrepared(repo,prepared);
  const original=(await repo.read(prepared.path)).content;
  for(const operation of ["archive","delete"]){
    await action(repo,prepared.path,operation,{confirm:prepared.path});
    await assert.rejects(()=>repo.read(prepared.path));
    const page=(await listPages(repo)).pages.find(p=>p.path===prepared.path);
    assert.equal(page.status,operation==="archive"?"archived":"deleted");
    assert.equal((await repo.tree()).some(p=>p.path.includes("archive/")),false);
    assert.ok((await fs.readdir(path.join(directory,".cms-local/local-revisions"))).length);
    assert.equal((await repo.read("public/builder-pages.json")).content.includes("<main"),false);
    await action(repo,prepared.path,"restore",{confirm:prepared.path});
    assert.equal((await repo.read(prepared.path)).content,original);
  }
});

test("original nine routes are protected and destructive actions require exact confirmation and fresh CAS",async t=>{
  const {repo}=await fixture(t),prepared=await preparePage(repo,{slug:"protect-fixture"});await publishPrepared(repo,prepared);
  for(const operation of ["archive","delete","slug","restore"])await assert.rejects(()=>action(repo,"public/index.html",operation,{confirm:"public/index.html",slug:"renamed-home"}),e=>e.status===409);
  await assert.rejects(()=>action(repo,prepared.path,"delete",{confirm:"wrong"}));
  await assert.rejects(()=>pageAction(repo,{head:"outdated",path:prepared.path,action:"rename",title:"x",requestId:crypto.randomUUID()},admin,true),e=>e.status===409);
  assert.ok(await repo.read(prepared.path));
});

test("slug changes rewrite explicitly accepted internal links, canonical, sitemap and exact known redirects atomically",async t=>{
  const {repo}=await fixture(t),prepared=await preparePage(repo,{slug:"slug-before",title:"جابجایی"});await publishPrepared(repo,prepared);
  const old=(await repo.read("public/index.html")).content;
  await repo.commit(await repo.head(),[{path:"public/index.html",content:old.replace("</main>",'<p><a href="/slug-before/?test=1#part">پیوند ورودی</a></p></main>')}]);
  const impact=await listPages(repo,prepared.path);assert.equal(impact.impact.links.length,1);
  await assert.rejects(()=>action(repo,prepared.path,"delete",{confirm:prepared.path}),e=>e.status===409);
  await assert.rejects(()=>action(repo,prepared.path,"slug",{confirm:prepared.path,slug:"slug-after"}),e=>e.status===409);
  const result=await action(repo,prepared.path,"slug",{confirm:prepared.path,slug:"slug-after",updateLinks:true});
  assert.equal(result.path,"public/slug-after/index.html");await assert.rejects(()=>repo.read(prepared.path));
  assert.equal(parseHTML((await repo.read(result.path)).content).document.querySelector('link[rel="canonical"]').href,"https://luxtowelco.com/slug-after/");
  assert.ok((await repo.read("public/index.html")).content.includes('/slug-after/?test=1#part'));
  const sitemap=(await repo.read("public/sitemap.xml")).content;assert.ok(sitemap.includes("https://luxtowelco.com/slug-after/"));assert.equal(sitemap.includes("https://luxtowelco.com/slug-before/"),false);
  const redirects=(await repo.read("public/_redirects")).content;assert.ok(redirects.includes("/slug-before/ /slug-after/ 301"));assert.ok(redirects.includes("/slug-before /slug-after/ 301"));
  const server=await startLocal(repo.root,0);t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(origin+"/slug-before/",{redirect:"manual"});assert.equal(response.status,301);assert.equal(response.headers.get("location"),"/slug-after/");
  assert.equal((await fetch(origin+"/slug-after/")).status,200);
});

test("page actions are idempotent after lost responses and reject reused IDs with altered payloads",async t=>{
  const {repo}=await fixture(t),prepared=await preparePage(repo,{slug:"idempotent-fixture"});await publishPrepared(repo,prepared);
  const body={head:await repo.head(),path:prepared.path,action:"rename",title:"ثبت یکباره",requestId:crypto.randomUUID()};
  await pageAction(repo,body,admin,true);const head=await repo.head();
  const replay=await pageAction(repo,body,admin,true);assert.equal(replay.replayed,true);assert.equal(await repo.head(),head);
  await assert.rejects(()=>pageAction(repo,{...body,title:"محتوای دیگر"},admin,true),e=>e.status===409);
});

test("structured SEO values reject executable URLs, invalid language and malicious menu controls while escaping plain text",async t=>{
  const {repo}=await fixture(t),target="public/safe-seo/index.html";
  for(const patch of [{canonical:"javascript:alert(1)"},{canonical:"https://attacker.invalid/"},{ogImage:"data:image/svg+xml,<svg/>"},{language:"en"},{direction:"bad"},{menu:{included:"yes",order:0}},{menu:{included:true,order:Infinity}}])assert.throws(()=>validatePageMetadata(patch,target));
  const prepared=await preparePage(repo,{slug:"safe-seo",title:'<script>alert("fixture")</script>'});await publishPrepared(repo,prepared);
  const doc=parseHTML((await repo.read(target)).content).document;
  assert.equal(doc.querySelectorAll("main script").length,0);assert.equal(doc.querySelector("main h1").textContent,'<script>alert("fixture")</script>');
});

test("sitemap updates preserve genuine existing hreflang equivalents and no-menu publications leave other page HTML byte-identical",async t=>{
  const {repo}=await fixture(t),original=(await repo.read("public/index.html")).content,prepared=await preparePage(repo,{slug:"no-side-effects"});await publishPrepared(repo,prepared);
  assert.equal((await repo.read("public/index.html")).content,original);
  const doc=parseHTML((await repo.read("public/sitemap.xml")).content).document;
  const home=[...doc.querySelectorAll("url")].find(url=>url.querySelector("loc").textContent==="https://luxtowelco.com/");
  assert.equal(home.querySelectorAll("xhtml\\:link").length,2);
});

test("GitHub deletion writes a null tree entry without a blob and uses a non-forced atomic reference update",async()=>{
  const repo=new GitHubRepository({CMS_REPOSITORY:"fixture/isolated",CMS_GITHUB_TOKEN:"fixture"}),head="a".repeat(40),calls=[];
  repo.call=async(endpoint,method="GET",body)=>{calls.push({endpoint,method,body});if(endpoint==="git/ref/heads/main")return {object:{sha:head}};if(endpoint.startsWith("git/commits/"))return {tree:{sha:"b".repeat(40)}};return {sha:"c".repeat(40)};};
  await repo.commit(head,[{path:"public/fixture/index.html",delete:true}],"fixture deletion");
  assert.equal(calls.some(call=>call.endpoint==="git/blobs"),false);
  assert.equal(calls.find(call=>call.endpoint==="git/trees").body.tree[0].sha,null);
  assert.equal(calls.at(-1).body.force,false);
});

test("anonymous/editor page mutations and cross-origin requests are denied; editors can safely prepare drafts",async t=>{
  const {repo}=await fixture(t),account={username:"fixture-editor",role:"editor",salt:bytes64(crypto.getRandomValues(new Uint8Array(24)))};
  account.hash=await passwordHash("fixture-only-password",account.salt);
  const env={CMS_USERS:JSON.stringify([account]),CMS_SESSION_SECRET:"fixture-session-".repeat(5),CMS_GITHUB_TOKEN:"fixture",CMS_GUARD:{idFromName:id=>id,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
  const origin="https://luxtowelco.com",cookie=(await login(new Request(origin+"/api/cms/login"),env,{username:account.username,password:"fixture-only-password"})).split(";")[0];
  const request=(endpoint,body,auth=true,source=origin)=>new Request(origin+"/api/cms/builder/pages"+endpoint,{method:"POST",headers:{Origin:source,"X-CMS-Request":"1","Content-Type":"application/json",...(auth?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  const head=await repo.head();
  assert.equal((await handleCMS(request("/action",{},false),env,{repo})).status,401);
  assert.equal((await handleCMS(request("/action",{}),env,{repo})).status,403);
  assert.equal((await handleCMS(request("/prepare",{slug:"editor-draft"},true,"https://invalid.example"),env,{repo})).status,403);
  const response=await handleCMS(request("/prepare",{slug:"editor-draft"}),env,{repo});assert.equal(response.status,200);const body=await response.json();assert.equal(body.model.base.revision,"new");assert.equal(body.model.page.id,body.model.base.creation.id);
  assert.equal(await repo.head(),head);
});
