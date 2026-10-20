import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {FONT_CATALOG,FONT_IDS,fontFacesCSS,fontStack} from '../public/admin/builder/fonts.js';
import {validStyle,effectiveStyle,clone} from '../public/admin/builder/model.js';
import {layoutCSS} from '../public/admin/builder/layout.js';
import {builderPage,publishBuilder} from '../src/builder.js';
import {githubSimulation} from './github-simulation.mjs';

test('curated fonts are allowlisted; arbitrary CSS and URLs remain rejected',()=>{
 for(const fontFamily of FONT_IDS)assert.ok(validStyle({fontFamily}));
 for(const fontFamily of ['url(https://evil.invalid)','Inter;position:fixed','unknown','"Lato"'])assert.equal(validStyle({fontFamily}),false);
 assert.throws(()=>fontStack('evil'));
});
test('untouched typography has no font faces or new font requests; deleted choices are excluded',()=>{
 assert.equal(fontFacesCSS([{style:{}}]),'');
 assert.equal(fontFacesCSS([{deleted:true,style:{fontFamily:'Inter'}}]),'');
 assert.equal(fontFacesCSS([{style:{fontFamily:'Tahoma'}}]),'');
});
test('font inheritance and responsive rules preserve explicit values and safe fallback stacks',()=>{
 const e={id:'new-font-test',type:'heading',layouts:{desktop:{},tablet:{},mobile:{}},style:{fontFamily:'Vazirmatn'},responsiveStyles:{tablet:{fontFamily:'Estedad'},mobile:{fontFamily:'Inter'}}};
 assert.equal(effectiveStyle(e,'mobile').fontFamily,'Inter');delete e.responsiveStyles.mobile.fontFamily;assert.equal(effectiveStyle(e,'mobile').fontFamily,'Estedad');
 const css=layoutCSS([e]);assert.match(css,/"Vazirmatn",Tahoma,Arial,sans-serif/);assert.match(css,/"Estedad",Tahoma,Arial,sans-serif/);assert.doesNotMatch(css,/inter-variable/);
 assert.equal((fontFacesCSS([e,e]).match(/@font-face/g)||[]).length,2);
});
test('all curated font bytes match pinned upstream SHA256 and retain licenses',async()=>{
 const sources=JSON.parse(await fs.readFile('public/assets/builder-fonts/sources.json','utf8'));
 const serialized=JSON.stringify(sources);
 for(const f of FONT_CATALOG)for(const [file]of f.files){const bytes=await fs.readFile('public/assets/builder-fonts/'+file);assert.equal(bytes.subarray(0,4).toString(),'wOF2');assert.ok(serialized.includes(createHash('sha256').update(bytes).digest('hex')),file);}
 for(const f of FONT_CATALOG){const license=await fs.readFile(`public/assets/builder-fonts/${f.id}-LICENSE.txt`,'utf8');assert.match(license,/SIL OPEN FONT LICENSE/i);}
});
test('real static publication exports chosen fonts and responsive CSS without editor input or UI',async()=>{
 const {repo,state}=await githubSimulation(),file=await repo.read('public/index.html'),base=builderPage(file.content,file.sha,'public/index.html'),model=clone(base.model),title=model.elements.find(e=>e.tag==='h1');
 title.style.fontFamily='Vazirmatn';title.responsiveStyles={mobile:{fontFamily:'Inter'}};
 await publishBuilder(repo,{model,requestId:crypto.randomUUID()},{username:'fixture-admin',role:'admin'},false);
 const html=state.files.get('public/index.html').toString();
 assert.match(html,/vazirmatn-variable\.woff2/);assert.match(html,/inter-variable\.woff2/);assert.doesNotMatch(html,/shabnam-regular\.woff2/);
 assert.doesNotMatch(html,/canvas-hit-plane|direct-edit-bar|font-preview|customer-selection-style/);
 const reopened=builderPage(html,'next-font-revision','public/index.html').model.elements.find(e=>e.id===title.id);
 assert.equal(reopened.style.fontFamily,'Vazirmatn');assert.equal(reopened.responsiveStyles.mobile.fontFamily,'Inter');
});
test('editor sandbox stays script-disabled and page scripts/handlers are removed',async()=>{
 const editor=await fs.readFile('public/admin/builder/index.html','utf8');assert.match(editor,/id="page"[^>]*sandbox="allow-same-origin"/);assert.doesNotMatch(editor,/id="page"[^>]*allow-scripts/);
 const page=builderPage(await fs.readFile('public/index.html','utf8'),'fixture-secure-font','public/index.html');
 assert.doesNotMatch(page.html,/<script\b|\sonclick=/i);assert.match(page.html,/touch-action:auto/);
});
