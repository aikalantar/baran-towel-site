// Authentication return destinations are a small allowlist, never arbitrary URLs.
export function adminDestination(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020%]/.test(value.split('?')[0])) return '/admin/';
  let url;
  try { url = new URL(value, 'https://cms.invalid'); } catch { return '/admin/'; }
  if (url.origin !== 'https://cms.invalid' || !['/admin/', '/admin/builder/', '/admin/editor/'].includes(url.pathname)) return '/admin/';
  if (url.pathname === '/admin/') return '/admin/';
  const query = new URLSearchParams();
  const path = url.searchParams.get('path'), ref = url.searchParams.get('ref');
  if (/^public\/(?!admin\/)(?:[a-z0-9-]+\/)*index\.html$/.test(path || '')) query.set('path', path);
  if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref || '')) query.set('ref', ref);
  return url.pathname + (query.size ? '?' + query : '');
}

export function builderLoginURL(value) {
  return '/admin/?next=' + encodeURIComponent(adminDestination(value));
}
