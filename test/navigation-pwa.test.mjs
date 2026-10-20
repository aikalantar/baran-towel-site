import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { adminDestination, builderLoginURL } from '../public/admin/routes.js';

test('return-to allowlist excludes external URLs, encoded paths, backslashes and non-CMS destinations', () => {
  for (const value of [null, '', 'https://evil.invalid/admin/builder/', '//evil.invalid/admin/', '/\\evil.invalid/admin/', '/%61dmin/builder/', '/admin/builder/%2e%2e/', '/api/cms/publish', '/admin/other/', '/admin/builder/\n', 'javascript:alert(1)']) assert.equal(adminDestination(value), '/admin/', String(value));
});
test('return-to keeps only validated Builder page and revision and strips redirect payloads', () => {
  const destination = '/admin/builder/?path=public%2Fen%2Fcatalog%2Findex.html&ref=' + 'a'.repeat(40);
  assert.equal(adminDestination(destination + '&next=https://evil.invalid#bad'), destination);
  assert.equal(adminDestination('/admin/builder/?path=public%2Fadmin%2Findex.html&ref=evil'), '/admin/builder/');
  assert.equal(adminDestination('/admin/?next=//evil.invalid'), '/admin/');
  assert.equal(new URL(builderLoginURL(destination), 'https://cms.invalid').searchParams.get('next'), destination);
});
test('CMS manifest is separate, branded, scoped and uses existing correctly sized PNG icons', async () => {
  const manifest = JSON.parse(await fs.readFile('public/admin/cms.webmanifest', 'utf8'));
  assert.equal(manifest.id, '/admin/'); assert.equal(manifest.scope, '/admin/'); assert.equal(manifest.start_url, '/admin/');
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.dir, 'rtl'); assert.equal(manifest.lang, 'fa'); assert.ok(manifest.name.includes('باران'));
  for (const icon of manifest.icons) { const bytes = await fs.readFile('public' + icon.src); const [width,height] = icon.sizes.split('x').map(Number); assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height); assert.ok([192,512].includes(width)); }
  for (const file of ['public/admin/index.html','public/admin/builder/index.html']) assert.ok((await fs.readFile(file, 'utf8')).includes('href="/admin/cms.webmanifest"'));
});
test('install module has no service worker, cache storage, local draft or credential persistence', async () => {
  const code = await fs.readFile('public/admin/pwa.js', 'utf8');
  assert.doesNotMatch(code, /serviceWorker\s*\.|caches\s*\.|indexedDB\s*\.|localStorage\s*\.|sessionStorage\s*\.|fetch\s*\(/);
  const headers = await fs.readFile('public/_headers', 'utf8'); assert.match(headers, /\/admin\/\*\s+Cache-Control: no-store/);
  assert.match(await fs.readFile('src/cms-worker.js','utf8'), /Cache-Control["']?:?\s*["']no-store/);
});
