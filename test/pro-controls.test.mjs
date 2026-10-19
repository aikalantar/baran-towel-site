import test from "node:test";
import assert from "node:assert/strict";
import { inheritedStyle, effectiveLayout, selectedRoots, subtreeIds, groupElements, ungroupElements, cloneSubtrees, alignElements, moveLayer } from "../public/admin/builder/pro-controls.js";

function element(id, x, y, width = 20, height = 10, extra = {}) {
  return { id, type: "text", source: null, tag: "p", parentId: "section-1", anchor: "section-1", layoutMode: "free", layouts: { desktop: { x, y, width, height }, tablet: {}, mobile: { x: x + 1, y: y + 2, width: width + 4, height: height + 3 } }, content: { text: id }, style: {}, responsiveStyles: { tablet: {}, mobile: {} }, z: 1, order: 1, deleted: false, ...extra };
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < .02, `${actual} ≠ ${expected}`);

test("responsive style inheritance is explicit and leaves other devices untouched", () => {
  const e = element("new-a", 5, 10, 20, 10, { style: { fontSize: 30, color: "#112233" }, responsiveStyles: { tablet: { fontSize: 24 }, mobile: { color: "#ffffff" } } });
  assert.deepEqual(inheritedStyle(e, "tablet"), { fontSize: 24, color: "#112233" });
  assert.deepEqual(inheritedStyle(e, "mobile"), { fontSize: 24, color: "#ffffff" });
  assert.equal(e.style.fontSize, 30);
  assert.equal(effectiveLayout(e, "tablet").width, 20);
  e.layouts.tablet.x = 17;
  assert.equal(effectiveLayout(e, "mobile").x, e.layouts.mobile.x);
  e.layouts.mobile = {};
  assert.equal(effectiveLayout(e, "mobile").x, 17);
  e.responsiveInheritance = false;
  assert.deepEqual(effectiveLayout(e, "mobile"), {});
});

test("nested selection chooses top roots and traverses full active subtree", () => {
  const elements = [element("new-a", 0, 0), element("new-b", 0, 0, 20, 10, { parentId: "new-a" }), element("new-c", 0, 0, 20, 10, { parentId: "new-b" }), element("new-d", 0, 0, 20, 10, { deleted: true, parentId: "new-a" })];
  assert.deepEqual(selectedRoots(elements, ["new-c", "new-a", "new-b"]), ["new-a"]);
  assert.deepEqual([...subtreeIds(elements, ["new-a"])], ["new-a", "new-b", "new-c"]);
});

test("group and ungroup preserve all breakpoint geometry and source inputs", () => {
  const original = [element("new-a", 5, 10), element("new-b", 40, 35, 15, 20)], snapshot = JSON.stringify(original);
  const grouped = groupElements(original, ["new-a", "new-b"], "new-group");
  const group = grouped.elements.find(e => e.id === "new-group");
  assert.equal(group.type, "container"); assert.equal(group.kind, "group");
  assert.equal(grouped.elements[0].parentId, group.id);
  assert.equal(JSON.stringify(original), snapshot);
  const restored = ungroupElements(grouped.elements, [group.id]);
  assert.equal(restored.elements.find(e => e.id === group.id).deleted, true);
  for (const e of original) for (const device of ["desktop", "tablet", "mobile"]) for (const field of ["x", "y", "width", "height"]) close(effectiveLayout(restored.elements.find(item => item.id === e.id), device)[field], effectiveLayout(e, device)[field]);
});

test("group refuses original dependent, locked, flow and cross-parent elements", () => {
  for (const change of [e => e.source = { selector: "fixture" }, e => e.locked = true, e => e.layoutMode = "flow", e => e.parentId = "section-other"]) {
    const elements = [element("new-a", 0, 0), element("new-b", 20, 20)]; change(elements[1]);
    assert.throws(() => groupElements(elements, ["new-a", "new-b"], "new-group"));
  }
});

test("subtree clipboard creates fresh nested IDs and independent responsive copies", () => {
  const elements = [element("new-a", 5, 5, 50, 40, { type: "container", kind: "group" }), element("new-b", 0, 0, 20, 10, { parentId: "new-a", responsiveStyles: { tablet: { padding: 10 }, mobile: { fontSize: 17 } } })];
  let count = 0;
  const result = cloneSubtrees(elements, ["new-a", "new-b"], { idFactory: () => `new-copy-${++count}` });
  assert.deepEqual(result.ids, ["new-copy-1"]); assert.equal(result.elements[1].parentId, "new-copy-1");
  assert.equal(result.elements[0].layouts.desktop.x, 7); assert.equal(result.elements[1].layouts.desktop.x, 0);
  result.elements[1].responsiveStyles.mobile.fontSize = 44;
  assert.equal(elements[1].responsiveStyles.mobile.fontSize, 17);
  assert.throws(() => cloneSubtrees(elements, ["new-a"], { idFactory: () => "new-a" }));
});

test("alignment and distribution affect current breakpoint only", () => {
  const elements = [element("new-a", 0, 0, 10), element("new-b", 25, 15, 20), element("new-c", 80, 25, 10)], ids = elements.map(e => e.id);
  const aligned = alignElements(elements, ids, "mobile", "left");
  assert.equal(aligned[0].layouts.mobile.x, aligned[2].layouts.mobile.x);
  assert.equal(aligned[1].layouts.desktop.x, 25);
  const distributed = alignElements(elements, ids, "desktop", "distribute-x");
  close(distributed[1].layouts.desktop.x, 35);
  assert.throws(() => alignElements(elements, ids.slice(0, 2), "desktop", "distribute-x"));
});

test("moving a layer crosses the nearest sibling even when z values have gaps", () => {
  const elements = [element("new-a", 0, 0, 10, 10, { z: 10 }), element("new-b", 0, 0, 10, 10, { z: 50 }), element("new-c", 0, 0, 10, 10, { z: 100 })];
  const forward = moveLayer(elements, ["new-a"], "front");
  assert.equal(forward[0].z, 51); assert.equal(forward[1].z, 50); assert.equal(elements[0].z, 10);
  const backward = moveLayer(elements, ["new-c"], "back"); assert.equal(backward[2].z, 49);
});

test("professional control UI applies styles, responsive reset, nested clipboard and grouping in Chrome", { timeout: 120000 }, async t => {
  const [{ default: http }, { default: fs }, { chromium }] = await Promise.all([import("node:http"), import("node:fs/promises"), import("@playwright/test")]);
  const html = `<!doctype html><html lang="fa" dir="rtl"><body><aside class="inspector"><section id="properties"></section></aside><main id="fixture-canvas" style="position:relative;width:800px;height:500px"></main><script type="module">
    import {installProfessionalControls,inheritedStyle,effectiveLayout} from '/pro-controls.js';
    const make=(id,x)=>({id,type:'text',source:null,tag:'p',parentId:'section-1',anchor:'section-1',layoutMode:'free',content:{text:id},layouts:{desktop:{x,y:10,width:20,height:20},tablet:{},mobile:{}},style:{fontSize:30,padding:5},responsiveStyles:{tablet:{},mobile:{}},z:1,deleted:false});
    window.state={model:{schemaVersion:2,base:{revision:'fixture'},elements:[make('new-a',5),make('new-b',50)]},selected:['new-a'],device:'desktop',past:[],notices:[],callbacks:[]};
    const ctx={getModel:()=>state.model,getSelected:()=>state.selected,getDevice:()=>state.device,getBase:()=>({}),getNode:id=>document.querySelector('[data-fixture-id="'+id+'"]'),mutate:fn=>{state.past.push(structuredClone(state.model));let next=structuredClone(state.model);fn(next);state.model=next;render();return true},select:(id,multiple=false)=>{state.selected=multiple?[...state.selected,id]:[id];state.callbacks.forEach(fn=>fn())},notice:str=>state.notices.push(str),onUpdate:fn=>state.callbacks.push(fn)};
    window.render=()=>{const root=document.querySelector('#fixture-canvas');root.replaceChildren();for(const e of state.model.elements.filter(e=>!e.deleted)){let n=document.createElement(e.type==='container'?'div':'p');n.dataset.fixtureId=e.id;n.textContent=e.content.text;n.style.position='absolute';const l=effectiveLayout(e,state.device);for(const key of ['x','y','width','height'])n.style[{x:'left',y:'top',width:'width',height:'height'}[key]]=l[key]+'%';for(const [key,val] of Object.entries(inheritedStyle(e,state.device)))n.style[key]=typeof val==='number'&&!['opacity','fontWeight','lineHeight'].includes(key)?val+'px':val;root.append(n)}for(const e of state.model.elements.filter(e=>!e.deleted)){const node=ctx.getNode(e.id),parent=ctx.getNode(e.parentId);if(parent)parent.append(node)}state.callbacks.forEach(fn=>fn())};render();installProfessionalControls(ctx);window.fixtureReady=true;
  </script></body></html>`;
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (/^\/[a-z][a-z0-9-]*\.js$/.test(pathname)) { response.setHeader("Content-Type", "text/javascript"); response.end(await fs.readFile(`public/admin/builder${pathname}`)); }
      else { response.setHeader("Content-Type", "text/html"); response.end(html); }
    } catch { response.statusCode = 500; response.end("fixture unavailable"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.fixtureReady);
    assert.equal(await page.locator("[data-pro-style]").count(), 30);
    await page.evaluate(()=>{state.warningFixture=structuredClone(state.model);state.model.elements[0].layouts.desktop.x=-5;render();});
    assert.match(await page.locator('.pro-warning').innerText(),/بیرون زده/);
    assert.equal(await page.evaluate(()=>state.model.elements[0].layouts.desktop.x),-5,'A recommendation must not rewrite customer geometry');
    await page.evaluate(()=>{state.model.elements[0].layouts.desktop.x=5;state.model.elements[1].layouts.desktop.x=10;render();});
    assert.match(await page.locator('.pro-warning').innerText(),/هم‌پوشانی/);
    await page.evaluate(()=>{state.model=state.warningFixture;delete state.warningFixture;render();});
    await page.locator("summary").filter({ hasText: "نوشتار" }).click();
    await page.locator("#pro-fontSize").fill("42"); await page.locator("#pro-fontSize").press("Tab");
    assert.equal(await page.evaluate(() => state.model.elements[0].style.fontSize), 42);
    assert.equal(await page.locator('[data-fixture-id="new-a"]').evaluate(node => getComputedStyle(node).fontSize), "42px");
    await page.evaluate(() => { state.device = "mobile"; render(); });
    await page.locator("#pro-fontSize").fill("19"); await page.locator("#pro-fontSize").press("Tab");
    assert.equal(await page.evaluate(() => state.model.elements[0].responsiveStyles.mobile.fontSize), 19);
    assert.equal(await page.evaluate(() => state.model.elements[0].style.fontSize), 42);
    assert.equal(await page.locator('[data-fixture-id="new-a"]').evaluate(node => getComputedStyle(node).fontSize), "19px");
    await page.locator('[data-pro-reset="fontSize"]').click();
    assert.equal(await page.evaluate(() => state.model.elements[0].responsiveStyles.mobile.fontSize), undefined);
    assert.equal(await page.locator('[data-fixture-id="new-a"]').evaluate(node => getComputedStyle(node).fontSize), "42px");
    await page.evaluate(() => { state.device = "desktop"; state.selected = ["new-a", "new-b"]; render(); });
    const historyBefore = await page.evaluate(() => state.past.length);
    await page.locator('[data-pro-action="group"]').click();
    assert.equal(await page.evaluate(() => state.model.elements.filter(element => !element.deleted).length), 3);
    assert.equal(await page.evaluate(() => state.past.length), historyBefore + 1);
    const groupId = await page.evaluate(() => state.selected[0]);
    assert.equal(await page.locator(`[data-fixture-id="${groupId}"] > [data-fixture-id]`).count(), 2);
    await page.locator('[data-pro-action="copy"]').click(); await page.locator('[data-pro-action="paste"]').click();
    assert.equal(await page.evaluate(() => state.model.elements.filter(element => !element.deleted).length), 6);
    const copyId = await page.evaluate(() => state.selected[0]);
    assert.equal(await page.locator(`[data-fixture-id="${copyId}"] > [data-fixture-id]`).count(), 2);
    await page.locator('[data-pro-action="ungroup"]').click();
    assert.equal(await page.evaluate(() => state.selected.length), 2);
    assert.equal(await page.evaluate(() => state.model.elements.filter(element => !element.deleted).length), 5);
    await page.locator('[data-pro-action="lock"]').click();
    assert.equal(await page.evaluate(() => state.model.elements.filter(element => state.selected.includes(element.id)).every(element => element.locked)), true);
    assert.equal(await page.locator('#pro-fontSize').isDisabled(),true);
    await page.locator('[data-pro-action="lock"]').click();
    assert.equal(await page.evaluate(() => state.model.elements.filter(element => state.selected.includes(element.id)).some(element => element.locked)), false);
    await page.evaluate(() => { state.device = "tablet"; render(); });
    await page.locator('[data-pro-action="hide"]').click();
    assert.equal(await page.evaluate(() => state.model.elements.filter(element => state.selected.includes(element.id)).every(element => element.layouts.tablet.hidden)), true);
    assert.equal(await page.evaluate(() => state.model.elements.filter(element => state.selected.includes(element.id)).some(element => element.layouts.desktop.hidden)), false);
    await page.evaluate(() => {
      state.model.sections = [{ id: "section-1", type: "container", kind: "section", parentId: "page", anchor: "section-1", source: { anchor: "section-1" }, content: { text: "بخش اصلی" }, style: {}, responsiveStyles: { tablet: {}, mobile: {} }, layouts: { desktop: {}, tablet: {}, mobile: {} }, deleted: false }];
      state.selected = ["section-1"]; render();
    });
    await page.locator("summary").filter({ hasText: "فاصله و اندازه" }).click();
    await page.locator("#pro-padding").fill("24"); await page.locator("#pro-padding").press("Tab");
    assert.equal(await page.evaluate(() => state.model.sections[0].responsiveStyles.tablet.padding), 24);
    assert.equal(await page.evaluate(() => state.model.elements[0].style.padding), 5);
    assert.equal(await page.locator("#pro-layout-mode").isDisabled(), true);
    await page.locator('[data-pro-action="lock"]').click();
    assert.equal(await page.evaluate(() => state.model.sections[0].locked), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => state.notices.filter(message => !message.includes("کپی شدند"))), []);
    t.diagnostic("styles, responsive reset, clipboard, grouping, locks and advisory overflow/overlap warnings in Chrome; no console errors or publishing requests");
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
