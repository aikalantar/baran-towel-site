import test from "node:test";
import assert from "node:assert/strict";
import { BLOCKS, createBlock } from "../public/admin/builder/blocks.js";
import { SCHEMA_VERSION, HISTORY_LIMIT, History, clone, migrateModel, validModel, validStyle, effectiveLayout, effectiveStyle, encodeDraft, decodeDraft, stablePageID } from "../public/admin/builder/model.js";

const anchors = [{ id: "section-header", label: "سربرگ" }, { id: "section-main", label: "محتوا" }];
function legacy() {
  return { schemaVersion: 1, base: { path: "public/index.html", revision: "fixture-original-revision", title: "باران", idVersion: 1 }, elements: [
    { id: "base-original", type: "heading", tag: "h1", anchor: "section-main", source: { selector: "main > section > h1", textNodes: [0] }, movable: false, content: { text: "عنوان اصلی" }, layouts: { desktop: { x: 12, width: 50 }, mobile: { width: 90 } }, style: { color: "#123456", fontSize: 32 }, deleted: false, z: null },
    { id: "new-old-image", type: "image", tag: "img", anchor: "section-main", content: { src: "/assets-v3/gallery/nilo-01.webp", alt: "حوله" }, layouts: { desktop: { x: 20, y: 15, width: 30 }, mobile: { x: 2, width: 80 } }, style: {}, deleted: false, z: 2 },
  ] };
}
const base = () => { const v1 = legacy(); return migrateModel(v1, v1, anchors); };
function addBlock(model, kind, options = {}) { const nodes = createBlock(kind, { anchor: "section-main", ...options }); model.elements.push(...nodes); return nodes; }

test('explicit null and false breakpoint records fail closed instead of crashing rendering after import',()=>{
 const original=base();
 for(const value of [null,false,0,''])for(const key of ['layouts','freeLayouts']){const model=clone(original);if(key==='freeLayouts')model.elements[0].freeLayouts={desktop:value};else model.elements[0].layouts.mobile=value;assert.equal(validModel(model,original,anchors),false);}
 const omitted=clone(original);delete omitted.elements[0].layouts.tablet;assert.equal(validModel(omitted,original,anchors),true,'An omitted override still inherits safely');
});

test("v1 migration preserves original identity, revision, content and legacy mobile geometry without mutating input", () => {
  const old = legacy(), before = clone(old), migrated = migrateModel(old, old, anchors);
  assert.deepEqual(old, before);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.page.id, stablePageID("public/index.html"));
  assert.equal(migrated.page.direction, "rtl");
  assert.deepEqual(migrated.base, old.base);
  assert.deepEqual(migrated.elements[0].source, old.elements[0].source);
  assert.equal(migrated.elements[0].parentId, "section-main");
  assert.equal(migrated.elements[0].layoutMode, "flow");
  assert.equal(migrated.elements[1].layoutMode, "free");
  assert.equal(migrated.elements[0].responsiveInheritance, false);
  assert.deepEqual(effectiveLayout(migrated.elements[0], "mobile"), { width: 90 });
  assert.deepEqual(effectiveLayout(migrated.elements[0], "tablet"), { x: 12, width: 50 });
  assert.deepEqual(migrated.elements[0].style, old.elements[0].style);
  assert.equal(migrated.sections[0].protected, true);
  assert.equal(validModel(migrated, migrated, anchors), true);
  assert.equal(validModel(old, migrated, anchors), true);
  assert.deepEqual(migrateModel(migrated, migrated, anchors), migrated);
});

test("English legacy pages retain LTR and actual paths; unsupported versions are rejected", () => {
  const old = legacy(); old.base.path = "public/en/catalog/index.html";
  const result = migrateModel(old, old, anchors);
  assert.equal(result.page.language, "en"); assert.equal(result.page.direction, "ltr");
  assert.equal(result.page.canonical, "https://luxtowelco.com/en/catalog/");
  assert.throws(() => migrateModel({ ...old, schemaVersion: 99 }, old, anchors));
});

test("new responsive values inherit predictably while reset reveals desktop/tablet defaults", () => {
  const [node] = createBlock("heading", { anchor: "section-main" });
  node.layouts = { desktop: { x: 10, width: 60 }, tablet: { width: 80 }, mobile: { x: 1 } };
  node.style = { fontSize: 32, color: "#123456", padding: 20 };
  node.responsiveStyles = { tablet: { fontSize: 24 }, mobile: { padding: 8 } };
  assert.deepEqual(effectiveLayout(node, "desktop"), { x: 10, width: 60 });
  assert.deepEqual(effectiveLayout(node, "tablet"), { x: 10, width: 80 });
  assert.deepEqual(effectiveLayout(node, "mobile"), { x: 1, width: 80 });
  assert.deepEqual(effectiveStyle(node, "mobile"), { fontSize: 24, color: "#123456", padding: 8 });
  node.layouts.mobile = {}; node.responsiveStyles.mobile = {};
  assert.deepEqual(effectiveLayout(node, "mobile"), { x: 10, width: 80 });
  assert.deepEqual(effectiveStyle(node, "mobile"), { fontSize: 24, color: "#123456", padding: 20 });
  node.layouts.tablet = {}; assert.deepEqual(effectiveLayout(node, "mobile"), { x: 10, width: 60 });
});

test("every core block validates against an original page and can be nested in a compatible container", () => {
  for (const block of BLOCKS) {
    const initial = base(), next = clone(initial), group = addBlock(next, "section")[0];
    const nodes = addBlock(next, block.id, { parentId: group.id });
    assert.equal(validModel(next, initial, anchors), true, block.id);
    assert.equal(nodes[0].parentId, group.id);
  }
});

test("cycles, unavailable parents, leaf parents, cross-section anchors and excessive depth fail closed", () => {
  const initial = base();
  for (const mutate of [
    nodes => { nodes[0].parentId = nodes[0].id; },
    nodes => { nodes[0].parentId = nodes[1].id; },
    nodes => { nodes[1].parentId = "new-missing"; },
    nodes => { nodes[0].parentId = "base-original"; },
    nodes => { nodes[1].anchor = "section-header"; },
    nodes => { nodes[0].id = nodes[1].id; },
  ]) {
    const next = clone(initial), nodes = addBlock(next, "section"); mutate(nodes);
    assert.equal(validModel(next, initial, anchors), false);
  }
  const deep = clone(initial); let parent = "section-main";
  for (let i = 0; i < 10; i++) { const nodes = addBlock(deep, "section", { parentId: parent }); parent = nodes[0].id; }
  assert.equal(validModel(deep, initial, anchors), false);
});

test("generated IDs and FAQ's exactly one first summary cannot be forged", () => {
  const initial = base();
  const forged = clone(initial), [node] = addBlock(forged, "heading"); node.id = "section-forged";
  assert.equal(validModel(forged, initial, anchors), false);
  for (const mutate of [
    (model, summary) => { summary.deleted = true; },
    (model, summary) => { summary.order = 4; },
    (model, summary) => { const second = clone(summary); second.id = "new-extra-summary"; second.order = 2; model.elements.push(second); },
    (model, summary) => { summary.parentId = "section-main"; },
  ]) {
    const next = clone(initial), nodes = addBlock(next, "faq"), summary = nodes.find(item => item.tag === "summary");
    mutate(next, summary); assert.equal(validModel(next, initial, anchors), false);
  }
});

test("original DOM selectors, immovable elements, base revisions and protected sections cannot be forged", () => {
  const initial = base();
  for (const mutate of [
    model => model.elements.shift(),
    model => { model.elements[0].source.selector = "body"; },
    model => { model.elements[0].type = "text"; },
    model => { model.elements[0].tag = "script"; },
    model => { model.elements[0].parentId = "section-header"; model.elements[0].anchor = "section-header"; model.elements[0].free = true; },
    model => { model.base.revision = "fixture-conflicting-revision"; },
    model => { model.sections[0].deleted = true; },
    model => { model.sections[0].order = 12; },
    model => { model.sections[0].protected = false; },
    model => { delete model.sections[0].protected; },
    model => { model.sections[1].protected = true; },
    model => { model.sections.pop(); },
    model => { model.page.id = "page-forged"; },
  ]) { const next = clone(initial); mutate(next); assert.equal(validModel(next, initial, anchors), false); }
});

test("unsafe styles, executable URLs, rich text injection and nonfinite coordinates are rejected", () => {
  const initial = base();
  for (const style of [
    { backgroundImage: "url(javascript:alert(1))" }, { backgroundImage: "https://evil.invalid/a.webp" },
    { color: "red;position:fixed" }, { fontFamily: "x;url(https://evil.invalid)" }, { fontSize: Infinity },
    { opacity: "1" }, { position: "fixed" }, { transform: "rotate(1deg)" }, { gridColumns: 1.5 },
  ]) assert.equal(validStyle(style), false);
  assert.equal(validStyle({ color: "#abcdef", borderColor: "#123456", opacity: .3, fontSize: 40, gridColumns: 3, backgroundImage: "/assets-v3/gallery/nilo-01.webp", objectFit: "contain", focalX: 25, focalY: 70 }), true);
  for (const mutate of [
    node => { node.content.href = "javascript:alert(1)"; },
    node => { node.content.href = "//evil.invalid"; },
    node => { node.content.runs = [{ text: node.content.text, href: "javascript:alert(1)" }]; },
    node => { node.content.runs = [{ text: node.content.text, onclick: "alert(1)" }]; },
    node => { node.content.runs = [{ text: "different" }]; },
    node => { node.content.runs = [{ text: node.content.text, bold: "true" }]; },
    node => { node.layouts.desktop.x = Infinity; },
    node => { node.layouts.mobile.height = -3; },
    node => { node.layouts.tablet.widthUnit = "em;background:red"; },
    node => { node.responsiveStyles.mobile = { color: "#fff;position:fixed" }; },
  ]) { const next = clone(initial), [node] = addBlock(next, "richtext"); mutate(node); assert.equal(validModel(next, initial, anchors), false); }
  const safeText = clone(initial), [node] = addBlock(safeText, "richtext"); node.content = { text: "<script>treated as text</script>" };
  assert.equal(validModel(safeText, initial, anchors), true);
});

test("page SEO and visibility validation reject unsafe canonicals, invalid directions and empty titles", () => {
  const initial = base();
  for (const change of [
    { title: " " }, { language: "en", direction: "rtl" }, { canonical: "https://evil.invalid/" },
    { canonical: "javascript:alert(1)" }, { robots: "all" }, { visibility: "private-admin-bypass" },
    { menu: { included: true, label: "menu", order: 1.5 } }, { ogImage: "https://evil.invalid/image.webp" },
  ]) { const next = clone(initial); Object.assign(next.page, change); assert.equal(validModel(next, initial, anchors), false); }
});

test("v1 history and image references migrate every undo/redo state and round trip as version 2", () => {
  const initial = legacy(), previous = clone(initial), current = clone(initial);
  previous.elements[0].content.text = "ویرایش پیشین"; current.elements[0].content.text = "ویرایش تازه";
  const fixtureImage = "data:image/png;base64,AA==";
  for (const model of [initial, previous, current]) model.elements[1].content.src = "asset:old-image";
  const raw = JSON.stringify({ version: 1, history: { past: [initial, previous], present: current, future: [] }, assets: { "old-image": fixtureImage } });
  const restored = decodeDraft(raw, base(), anchors);
  assert.equal(restored.present.schemaVersion, 2);
  assert.equal(restored.present.elements[1].content.src, fixtureImage);
  assert.ok(restored.undo()); assert.equal(restored.present.elements[0].content.text, "ویرایش پیشین");
  assert.ok(restored.undo()); assert.equal(restored.present.elements[0].content.text, "عنوان اصلی");
  assert.ok(restored.redo()); assert.ok(restored.redo());
  const encoded = encodeDraft(restored);
  assert.equal(JSON.parse(encoded).version, 2);
  assert.equal(encoded.split(fixtureImage).length - 1, 1);
  assert.deepEqual(decodeDraft(encoded, base(), anchors).serialize(), restored.serialize());
  const missing = JSON.parse(raw); missing.assets = {}; assert.throws(() => decodeDraft(JSON.stringify(missing), base(), anchors));
});

test("120 mixed tree/style/responsive edits survive draft recovery, full Undo/Redo and branching", () => {
  const initial = base(), history = new History(initial), expected = [clone(initial)];
  let latest;
  for (let i = 0; i < 140; i++) {
    const next = clone(history.present);
    if (i % 4 === 0) { const [node] = addBlock(next, "heading"); latest = node.id; node.content.text = `ویرایش ${i}`; }
    if (i % 4 === 1) { const node = next.elements.find(e => e.id === latest); node.style = { fontSize: 20 + i % 30, backgroundColor: "#123456" }; node.layouts.tablet = { x: i % 30, width: 70 }; node.responsiveStyles.mobile = { padding: i % 20 }; }
    if (i % 4 === 2) { const node = next.elements.find(e => e.id === latest), root = addBlock(next, "section")[0]; node.parentId = root.id; node.order = 3; }
    if (i % 4 === 3) { const node = next.elements.find(e => e.id === latest); node.deleted = true; }
    assert.equal(validModel(next, initial, anchors), true, `operation ${i}`);
    assert.ok(history.commit(next)); expected.push(clone(next));
  }
  assert.equal(history.past.length, HISTORY_LIMIT);
  const restored = decodeDraft(encodeDraft(history), initial, anchors), end = clone(restored.present);
  for (let i = 0; i < 120; i++) assert.ok(restored.undo());
  assert.deepEqual(restored.present, expected[20]); assert.equal(restored.undo(), false);
  for (let i = 0; i < 120; i++) assert.ok(restored.redo());
  assert.deepEqual(restored.present, end); assert.equal(restored.redo(), false);
  restored.undo(); const branch = clone(restored.present); branch.page.description = "مسیر تازه تاریخچه"; restored.commit(branch);
  assert.equal(restored.future.length, 0);
});
