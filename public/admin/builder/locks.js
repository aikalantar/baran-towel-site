// Editor locks include descendants. They are editing affordances, not permissions.
const nodes = model => [...(model.sections || []), ...(model.elements || [])];

export function lockedBy(model, id, includeSelf = true) {
  const all = new Map(nodes(model).map(element => [element.id, element]));
  let element = all.get(id);
  if (!includeSelf) element = all.get(element?.parentId || element?.anchor);
  const seen = new Set();
  while (element && !seen.has(element.id)) {
    if (element.locked) return element.id;
    seen.add(element.id);
    element = all.get(element.parentId || element.anchor);
  }
  return null;
}

export function allowsLockedChanges(previous, next) {
  const after = new Map(nodes(next).map(element => [element.id, element]));
  for (const element of nodes(previous)) {
    const owner = lockedBy(previous, element.id);
    if (!owner) continue;
    const replacement = after.get(element.id);
    if (JSON.stringify(element) === JSON.stringify(replacement)) continue;
    // Unlocking the selected owner is a separate, undoable action.
    if (owner === element.id && !lockedBy(previous, element.id, false) &&
        replacement?.locked === false &&
        JSON.stringify({...replacement, locked:true}) === JSON.stringify(element)) continue;
    return false;
  }
  // Inserting into a locked container also edits that container's subtree.
  const before = new Map(nodes(previous).map(element => [element.id,element]));
  return nodes(next).every(element => {
    const old=before.get(element.id), parent=element.parentId || element.anchor;
    return old && (old.parentId || old.anchor)===parent || !lockedBy(previous,parent);
  });
}

// Publication compares a trusted, persisted baseline with a complete model. A
// separate explicit intent is needed when an owner ends the session locked again
// after legitimate unlock/edit/relock operations. This is not a role permission.
export function requiredUnlocks(previous,next) {
  const before=new Map(nodes(previous).map(e=>[e.id,e])),after=new Map(nodes(next).map(e=>[e.id,e]));
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):value;
  const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
  const beneath=(map,id,owner)=>{const seen=new Set();while(id&&!seen.has(id)){if(id===owner)return true;seen.add(id);const e=map.get(id);id=e?.parentId||e?.anchor;}return false;};
  return [...before.values()].filter(owner=>owner.locked===true&&after.get(owner.id)?.locked===true&&[...new Set([...before.keys(),...after.keys()])].some(id=>(beneath(before,id,owner.id)||beneath(after,id,owner.id))&&!equal(before.get(id),after.get(id)))).map(e=>e.id);
}
