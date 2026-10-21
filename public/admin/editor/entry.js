// DOM adapter for the existing runtime. Internal bindings are inert, never UI.
// Customer controls have their own shell; professional controls are not mounted.
const bindings=document.createElement('div');bindings.hidden=true;bindings.inert=true;bindings.id='engine-bindings';
bindings.innerHTML='<div class="canvas-label"><span id="device-label"></span></div><span id="element-id"></span><div id="layers"></div><div id="block-list"></div><div id="rich-tools"></div><div id="typography"></div><div id="image-picker"></div><span id="move-advice"></span>';
for(const id of ['page-selector','anchor','move-anchor','image-library','revisions','archives','width-unit','height-unit','textAlign']){const label=document.createElement('label');label.textContent=id;const select=document.createElement('select');select.id=id;for(const value of id.endsWith('-unit')?['%','px','vw','vh']:[])select.add(new Option(value,value));label.append(select);bindings.append(label);}
for(const id of ['x','y','width','height','order','z','fontSize','color','block-search','snap','guides']){const label=document.createElement('label');label.textContent=id;const input=document.createElement('input');input.id=id;input.type=['snap','guides'].includes(id)?'checkbox':id==='color'?'color':id==='block-search'?'search':'number';label.append(input);bindings.append(label);}
for(const id of ['preview','duplicate','delete','move-section','reset-layout','export','load-revision','load-current','download-archive','new-section','section-up','section-down','rich-bold','rich-italic','rich-underline']){const button=document.createElement('button');button.id=id;bindings.append(button);}
document.body.append(bindings);
await import('../builder/runtime.js');
