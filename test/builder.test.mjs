import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parseHTML } from "linkedom";
import { builderPage } from "../src/builder.js";
import { handleCMS } from "../src/cms-worker.js";
import { login, passwordHash, bytes64 } from "../src/auth.js";
import { History, clone, validModel, decodeDraft, encodeDraft, safeLink, safeImage } from "../public/admin/builder/model.js";

const home = await fs.readFile("public/index.html", "utf8");
const page = builderPage(home, "test-base-revision");
const initial = page.model;

test("builder retains real homepage structure and styles without active content", () => {
  const { document } = parseHTML(page.html);
  const { document: original } = parseHTML(home);
  assert.equal(document.querySelector("main").textContent, original.querySelector("main").textContent);
  assert.equal(document.querySelector("link[rel=stylesheet]").getAttribute("href"), original.querySelector("link[rel=stylesheet]").getAttribute("href"));
  assert.equal(document.querySelectorAll("main > section").length, original.querySelectorAll("main > section").length);
  assert.equal(document.querySelectorAll("script,iframe,object,embed,form,meta[http-equiv]").length, 0);
  assert.equal(new Set(initial.elements.map(e => e.id)).size, initial.elements.length);
  assert.ok(initial.elements.length > 40);
  assert.ok(validModel(initial, initial, page.anchors));
});
test("stable IDs survive content edits; originals are never mutated", async () => {
  const edited = builderPage(home.replace("باران؛ فراتر از حوله</h1>", "عنوان دیگر</h1>"), "test-base-revision");
  assert.deepEqual(edited.model.elements.map(e => e.id), initial.elements.map(e => e.id));
  assert.equal(await fs.readFile('public/index.html','utf8'),home);
});
test("mixed operations undo and redo beyond 100 entries and survive serialization", () => {
  const h = new History(initial);
  for (let i = 0; i < 110; i++) {
    const next = clone(h.present);
    next.elements[0].layouts.desktop = { x: i + 1, y: i / 2, width: 20, height: 25 };
    next.elements[1].content.text = `متن ${i}`;
    next.elements[2].deleted = i % 2 === 0;
    assert.ok(h.commit(next));
  }
  const last = clone(h.present);
  const restored = decodeDraft(encodeDraft(h), initial, page.anchors);
  for (let i = 0; i < 110; i++) assert.ok(restored.undo());
  assert.deepEqual(restored.present, initial);
  for (let i = 0; i < 110; i++) assert.ok(restored.redo());
  assert.deepEqual(restored.present, last);
  restored.undo(); restored.commit(initial); assert.equal(restored.future.length, 0);
});
test("local images are deduplicated across history and restored safely", async () => {
  const h = new History(initial), png = "data:image/png;base64," + (await fs.readFile("public/favicon-16x16-v2.png")).toString("base64");
  for (let i = 0; i < 5; i++) { const next = clone(h.present); next.elements[0].content.src = png; next.elements[0].content.alt = `${i}`; h.commit(next); }
  const encoded = encodeDraft(h);
  assert.equal(encoded.split(png).length - 1, 1);
  assert.equal(decodeDraft(encoded, initial, page.anchors).present.elements[0].content.src, png);
});
test("invalid drafts, unsafe URLs, selectors, styles, geometry and base versions fail closed", () => {
  for (const change of [
    m => m.base.revision = "different",
    m => m.elements[0].content.src = "javascript:alert(1)",
    m => m.elements[0].content.src = "data:image/svg+xml;base64,PHN2Zz4=",
    m => m.elements[1].content.href = "//example.invalid",
    m => m.elements[0].layouts.mobile.width = -1,
    m => m.elements[0].layouts.desktop.x = Infinity,
    m => m.elements[0].style.background = "url(https://example.invalid)",
    m => m.elements[0].source.selector = "body",
    m => m.elements.push(clone(m.elements[0])),
    m => m.elements.shift(),
  ]) { const next = clone(initial); change(next); assert.equal(validModel(next, initial, page.anchors), false); }
  assert.equal(safeLink("javascript:alert(1)"), false);
  assert.equal(safeImage("/assets/../bad.png"), false);
  assert.throws(() => decodeDraft("{}", initial, page.anchors));
  const h = new History(initial); const other = clone(initial); other.base.revision = "new";
  assert.throws(() => decodeDraft(encodeDraft(h), other, page.anchors));
});

test("builder API reuses authentication, supports editors, exposes no write operation", async () => {
  const account = { username: "builder-test", role: "editor", salt: bytes64(crypto.getRandomValues(new Uint8Array(24))) };
  const password = "only-a-generated-test-fixture-password";
  account.hash = await passwordHash(password, account.salt);
  const env = { CMS_USERS: JSON.stringify([account]), CMS_SESSION_SECRET: "fixture-only-".repeat(5), CMS_GITHUB_TOKEN: "fixture-only", CMS_GUARD: { idFromName: id => id, get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) } };
  let reads = 0, writes = 0;
  const repo = { read: async path => { reads++; assert.equal(path, "public/index.html"); return { content: home, sha: "fixture-revision" }; }, commit: async () => { writes++; } };
  const url = "https://luxtowelco.com/api/cms/builder";
  assert.equal((await handleCMS(new Request(url), env, { repo })).status, 401);
  assert.equal((await handleCMS(new Request(url), env, { repo, localMode: true })).status, 401);
  assert.equal(reads, 0);
  const cookie = (await login(new Request(url), env, { username: account.username, password })).split(";")[0];
  const response = await handleCMS(new Request(url, { headers: { Cookie: cookie } }), env, { repo });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).model.base.path, "public/index.html");
  const post = new Request(url, { method: "POST", headers: { Cookie: cookie, Origin: "https://luxtowelco.com", "X-CMS-Request": "1" } });
  assert.equal((await handleCMS(post, env, { repo })).status, 404);
  assert.equal(writes, 0);
  assert.equal(await fs.readFile("public/index.html", "utf8"), home);
});
