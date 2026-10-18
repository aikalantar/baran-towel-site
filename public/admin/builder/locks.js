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
