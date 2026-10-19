import test from 'node:test';
import assert from 'node:assert/strict';
import {lockedBy,allowsLockedChanges} from '../public/admin/builder/locks.js';

const fixture=()=>({sections:[{id:'section-main',parentId:'page',locked:false}],elements:[
  {id:'new-group',parentId:'section-main',locked:true,style:{}},
  {id:'new-child',parentId:'new-group',locked:false,content:{text:'original'},style:{}},
  {id:'new-sibling',parentId:'section-main',locked:false,content:{text:'sibling'}}
]});
test('locked containers protect descendant edits, insertion, reparenting, styles and deletion',()=>{
  const before=fixture();
  assert.equal(lockedBy(before,'new-child'),'new-group');
  for(const change of [m=>m.elements[1].content.text='changed',m=>m.elements[1].style.color='#ffffff',m=>m.elements[1].parentId='section-main',m=>m.elements.splice(1,1),m=>m.elements.push({id:'new-insert',parentId:'new-group'}),m=>m.elements[2].parentId='new-group']){
    const after=structuredClone(before);change(after);assert.equal(allowsLockedChanges(before,after),false);
  }
  const unrelated=structuredClone(before);unrelated.elements[2].content.text='changed';assert.equal(allowsLockedChanges(before,unrelated),true);
});
test('unlock is a separate permitted operation, nested locks and content cannot be changed together',()=>{
  const before=fixture(),after=structuredClone(before);after.elements[0].locked=false;
  assert.equal(allowsLockedChanges(before,after),true);
  after.elements[0].style.color='#ffffff';assert.equal(allowsLockedChanges(before,after),false);
  const nested=fixture();nested.elements[1].locked=true;const unlock=structuredClone(nested);unlock.elements[1].locked=false;
  assert.equal(allowsLockedChanges(nested,unlock),false);
  const edited=structuredClone(before);edited.elements[1].content.text='new';
  const unlocked=structuredClone(before);unlocked.elements[0].locked=false;
  assert.equal(allowsLockedChanges(unlocked,edited),true);
});
