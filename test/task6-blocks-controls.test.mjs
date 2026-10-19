import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {switchLayoutMode,groupElements,ungroupElements,effectiveLayout} from '../public/admin/builder/pro-controls.js';
import {createBlock,renderBlockNode} from '../public/admin/builder/blocks.js';
import {layoutCSS} from '../public/admin/builder/layout-v2.js';
import {imageInfo} from '../public/admin/builder/image-format.js';

const element=(id,x=10)=>({id,type:'text',tag:'p',source:null,parentId:'section-1',anchor:'section-1',layoutMode:'free',free:true,layouts:{desktop:{x,y:5,width:20,height:10},tablet:{x:x+1,width:30},mobile:{x:x+2,width:80,hidden:true}},content:{text:id},style:{},responsiveStyles:{tablet:{},mobile:{}},locked:false,deleted:false});

test('Free to Flow removes geometry from active CSS and restores every breakpoint without data loss',()=>{
 const original=[element('new-a')],snapshot=structuredClone(original);
 const flow=switchLayoutMode(original,['new-a'],'flow');
 assert.deepEqual(original,snapshot);assert.deepEqual(flow[0].freeLayouts,original[0].layouts);
 assert.deepEqual(flow[0].layouts,{desktop:{},tablet:{},mobile:{hidden:true}});
 const css=layoutCSS(flow);assert.ok(!css.includes('translate:'));assert.ok(!css.includes('position:absolute'));assert.ok(!css.includes('height:calc('));
 const back=switchLayoutMode(flow,['new-a'],'free');assert.deepEqual(back[0].layouts,original[0].layouts);assert.equal(back[0].freeLayouts,undefined);
});

test('Flow to Free first preserves the measured box and later visibility changes survive restoration',()=>{
 const e=element('new-a');e.layoutMode='flow';e.free=false;e.layouts={desktop:{},tablet:{},mobile:{}};
 const first=switchLayoutMode([e],['new-a'],'free',{device:'tablet',boxes:new Map([['new-a',{x:3,y:6,width:70,height:25}]])});
 assert.deepEqual(first[0].layouts.tablet,{x:3,y:6,width:70,height:25,widthUnit:'%',heightUnit:'%'});
 const flow=switchLayoutMode(first,['new-a'],'flow');flow[0].layouts.tablet.hidden=true;
 const back=switchLayoutMode(flow,['new-a'],'free');assert.equal(back[0].layouts.tablet.hidden,true);assert.equal(back[0].layouts.tablet.width,70);
 assert.throws(()=>switchLayoutMode([e],['new-a'],'free'),/اندازهٔ عنصر/);
});

test('Flow rejects a parent with free children while an explicit complete selection converts safely',()=>{
 const parent={...element('new-parent'),type:'container',kind:'group'},child={...element('new-child'),parentId:'new-parent'};
 const before=[parent,child];assert.throws(()=>switchLayoutMode(before,['new-parent'],'flow'),/فرزندان آزاد/);
 assert.equal(before[0].layoutMode,'free');const converted=switchLayoutMode(before,['new-parent','new-child'],'flow');assert.ok(converted.every(e=>e.layoutMode==='flow'));
 for(const change of [e=>e.source={selector:'#old'},e=>e.locked=true]){const next=structuredClone(before);change(next[0]);assert.throws(()=>switchLayoutMode(next,['new-parent'],'flow'));}
});

test('a one-pixel divider can enter Free without inflating its size or violating percent limits',()=>{
 const e=element('new-divider');e.type='divider';e.tag='hr';e.layoutMode='flow';e.free=false;e.layouts={desktop:{},tablet:{},mobile:{}};
 const moved=switchLayoutMode([e],[e.id],'free',{boxes:new Map([[e.id,{x:5,y:2,width:100,height:.02,pixelWidth:1200,pixelHeight:1}]])});
 assert.equal(moved[0].layouts.desktop.height,1);assert.equal(moved[0].layouts.desktop.heightUnit,'px');assert.equal(moved[0].layouts.desktop.widthUnit,'%');assert.equal(moved[0].layouts.desktop.pixelHeight,undefined);
});

test('nested group then two ungroup operations preserve desktop tablet mobile geometry',()=>{
 const original=[element('new-a',5),element('new-b',40),element('new-c',75)];
 const inner=groupElements(original,['new-a','new-b'],'new-inner');
 const outer=groupElements(inner.elements,['new-inner','new-c'],'new-outer');
 const unwrap=ungroupElements(outer.elements,['new-outer']);const final=ungroupElements(unwrap.elements,['new-inner']);
 for(const e of original)for(const device of ['desktop','tablet','mobile'])for(const key of ['x','y','width','height'])assert.ok(Math.abs(effectiveLayout(e,device)[key]-effectiveLayout(final.elements.find(n=>n.id===e.id),device)[key])<.03,`${e.id} ${device} ${key}`);
});

test('shared image renderer includes the original full-size candidate and deduplicates responsive widths',()=>{
 const [image]=createBlock('image',{anchor:'section-1'});image.content={...image.content,width:1280,height:960,variants:[{src:'/assets-v3/gallery/nilo-01.webp',width:640},{src:'/assets-v3/gallery/nilo-01.webp',width:640}]};
 const {document}=parseHTML('<html><body></body></html>'),node=renderBlockNode(document,image);
 assert.equal(node.getAttribute('srcset'),'/assets-v3/gallery/nilo-01.webp 640w, /assets-v3/gallery/nilo-01.webp 1280w');assert.equal(node.alt,image.content.alt);
});

test('all 210 existing PNG JPEG WebP assets pass complete-container validation',async()=>{
 let count=0;async function walk(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){const filename=path.join(folder,entry.name);if(entry.isDirectory())await walk(filename);else if(/\.(png|jpe?g|webp)$/i.test(filename)){const info=imageInfo(new Uint8Array(await fs.readFile(filename)));assert.ok(info.width>0&&info.height>0,filename);count++;}}}
 await walk('public');assert.ok(count>=210);console.log(`Validated ${count} existing raster assets without printing image contents.`);
});

test('PNG header-only, missing end, trailing payload, corrupt IDAT CRC and animation fail closed',async()=>{
 const png=new Uint8Array(await fs.readFile('public/favicon-32x32-v2.png'));
 assert.equal(imageInfo(png).mime,'image/png');
 for(const bytes of [png.slice(0,33),png.slice(0,-12),new Uint8Array([...png,0])])assert.throws(()=>imageInfo(bytes));
 const bad=png.slice();bad[bad.length-16]^=1;assert.throws(()=>imageInfo(bad));
});

test('JPEG frame headers without scan/end and truncated WebP containers fail closed',async()=>{
 const fake=Uint8Array.from([255,216,255,192,0,17,8,0,32,0,32,3,1,17,0,2,17,0,3,17,0,255,217]);assert.throws(()=>imageInfo(fake));
 const webp=new Uint8Array(await fs.readFile('public/assets-v3/gallery/nilo-01.webp'));assert.equal(imageInfo(webp).mime,'image/webp');
 for(const bytes of [webp.slice(0,30),webp.slice(0,-1)])assert.throws(()=>imageInfo(bytes));
 const incomplete=webp.slice(0,30);new DataView(incomplete.buffer).setUint32(4,incomplete.length-8,true);assert.throws(()=>imageInfo(incomplete));
});

test('WebP extended-canvas forgery cannot conceal actual raster dimensions or add a second raster',async()=>{
 const original=new Uint8Array(await fs.readFile('public/assets-v3/gallery/nilo-01.webp')),view=new DataView(original.buffer,original.byteOffset,original.byteLength);let chunk;
 for(let offset=12;offset+8<=original.length;){const size=view.getUint32(offset+4,true),kind=Buffer.from(original.slice(offset,offset+4)).toString('ascii');if(['VP8 ','VP8L'].includes(kind)){chunk=original.slice(offset,offset+8+size+(size%2));break;}offset+=8+size+(size%2);}
 assert.ok(chunk);const header=Buffer.alloc(30);header.write('RIFF');header.writeUInt32LE(22+chunk.length,4);header.write('WEBP',8);header.write('VP8X',12);header.writeUInt32LE(10,16);
 assert.throws(()=>imageInfo(new Uint8Array(Buffer.concat([header,chunk]))),/ابعاد/);
 const doubled=Buffer.concat([Buffer.from(original.slice(0,12)),chunk,chunk]);doubled.writeUInt32LE(doubled.length-8,4);assert.throws(()=>imageInfo(new Uint8Array(doubled)),/ابعاد/);
});
