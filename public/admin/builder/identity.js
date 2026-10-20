// Shared data-only identity contract. Existing IDs are immutable; only an
// explicit clone allocates/remaps IDs. Imports and malformed HTML never repair
// duplicate IDs by guessing which node owns the customer's content.
export const newElementID = () => `new-${crypto.randomUUID()}`;
export const isElementID = id => typeof id === 'string' && id.length <= 100 && /^(?:base-[a-z0-9]+|new-[a-zA-Z0-9-]+)$/.test(id);
export const isNodeID = id => isElementID(id) || typeof id === 'string' && id.length <= 100 && /^section-[a-zA-Z0-9_-]+$/.test(id);
export function stableElementID(seed) {
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return `base-${(value >>> 0).toString(36)}`;
}
export function allocateIdentityMap(ids, {reserved = [], idFactory = newElementID, validate = isElementID} = {}) {
  const used = new Set(reserved), mapping = new Map();
  for (const old of ids) {
    if (!isElementID(old) || mapping.has(old)) throw new Error('شناسهٔ مبدأ تکثیر نامعتبر یا تکراری است؛ اصل محتوا تغییر نکرد.');
    const id = idFactory(old);
    if (!isElementID(id) || !validate(id) || used.has(id)) throw new Error('شناسهٔ تکثیر معتبر یا یکتا نیست؛ اصل محتوا تغییر نکرد.');
    used.add(id); mapping.set(old, id);
  }
  return mapping;
}
export function remapFragment(value, mapping) {
  if (typeof value !== 'string' || !value.startsWith('#')) return value;
  let id; try { id = decodeURIComponent(value.slice(1)); } catch { return value; }
  return mapping.has(id) ? '#' + mapping.get(id) : value;
}
export function remapElementIdentity(element, mapping) {
  const result = JSON.parse(JSON.stringify(element));
  for (const key of ['id','parentId','anchor']) if (mapping.has(result[key])) result[key] = mapping.get(result[key]);
  if (result.content) {
    if (result.content.href != null) result.content.href = remapFragment(result.content.href, mapping);
    for (const run of result.content.runs || []) if (run.href != null) run.href = remapFragment(run.href, mapping);
  }
  return result;
}
