import fs from 'node:fs';
import path from 'node:path';

const publicDir = path.resolve('public');
const baseUrl = process.env.SITE_AUDIT_BASE_URL || 'http://127.0.0.1:4175';
const errors = [];

const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const fullPath = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(fullPath) : [fullPath];
});

const htmlFiles = walk(publicDir).filter((file) => file.endsWith('.html'));
const htmlByRoute = new Map(htmlFiles.map((file) => {
  const relative = path.relative(publicDir, file).replaceAll('\\', '/');
  const route = relative === 'index.html' ? '/' : `/${relative.replace(/index\.html$/, '')}`;
  return [route, fs.readFileSync(file, 'utf8')];
}));

const addError = (file, message) => errors.push(`${path.relative(process.cwd(), file)}: ${message}`);
const attributes = (tag) => Object.fromEntries([...tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gs)].map((match) => [match[1], match[3]]));

const resolveInternalTarget = (value) => {
  const url = new URL(value, 'https://luxtowelco.com');
  if (url.origin !== 'https://luxtowelco.com') return null;
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) return path.join(publicDir, pathname.slice(1), 'index.html');
  return path.join(publicDir, pathname.slice(1));
};

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const route = [...htmlByRoute.entries()].find(([, value]) => value === html)?.[0] || file;
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) addError(file, `expected exactly one H1, found ${h1Count}`);
  if (!/<meta\s+name=["']description["']\s+content=["'][^"']+/i.test(html)) addError(file, 'missing meta description');
  if (!/<link\s+rel=["']canonical["']\s+href=["']https:\/\/luxtowelco\.com\//i.test(html)) addError(file, 'missing absolute self-canonical');

  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const attrs = attributes(tag);
    if (tag.includes('data-lightbox-image')) continue;
    if (!('alt' in attrs)) addError(file, `image missing alt: ${attrs.src || '(unknown source)'}`);
    if (!attrs.width || !attrs.height) addError(file, `image missing dimensions: ${attrs.src || '(unknown source)'}`);
  }

  for (const match of html.matchAll(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/gis)) {
    const value = match[2].trim();
    if (!value || value.startsWith('#') || /^(?:mailto:|tel:|data:|javascript:)/i.test(value)) continue;
    const target = resolveInternalTarget(value);
    if (target && !fs.existsSync(target)) addError(file, `broken internal reference ${value}`);
    if (target && value.includes('#') && target.endsWith('.html')) {
      const id = decodeURIComponent(new URL(value, 'https://luxtowelco.com').hash.slice(1));
      if (id && fs.existsSync(target) && !new RegExp(`\\bid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(fs.readFileSync(target, 'utf8'))) {
        addError(file, `missing fragment target ${value}`);
      }
    }
  }

  for (const script of html.matchAll(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi)) {
    try { JSON.parse(script[1]); } catch (error) { addError(file, `invalid JSON-LD: ${error.message}`); }
  }

  if (route === '/bridal-towels/' || route === '/catalog/') {
    if (!html.includes('lang="fa"') || !html.includes('dir="rtl"')) addError(file, 'Persian page must use lang=fa and dir=rtl');
  }
}

const bridalHtml = htmlByRoute.get('/bridal-towels/');
const catalogHtml = htmlByRoute.get('/catalog/');
const englishCatalogHtml = htmlByRoute.get('/en/catalog/');

if (!bridalHtml) errors.push('missing /bridal-towels/ route');
if (bridalHtml && (bridalHtml.match(/<details\b/g) || []).length !== 7) errors.push('/bridal-towels/: expected seven visible FAQ items');
if (bridalHtml?.includes('FAQPage')) errors.push('/bridal-towels/: FAQPage schema must not be present');
if ((catalogHtml?.match(/class="product-card(?:\s|\")/g) || []).length !== 6) errors.push('/catalog/: expected six semantic product sections');
if (catalogHtml?.match(/"@type"\s*:\s*"(?:Product|Offer)"/)) errors.push('/catalog/: Product or Offer schema must not be present');
if (catalogHtml?.includes('hreflang=') || englishCatalogHtml?.includes('hreflang=')) errors.push('catalogue pages are not equivalent and must not use hreflang');
if (!catalogHtml?.includes('۱۶٬۰۰۰٬۰۰۰ تومان') || !catalogHtml?.includes('۱۲٬۰۰۰٬۰۰۰ تومان')) errors.push('/catalog/: confirmed prices are missing');
if ((catalogHtml?.match(/استعلام قیمت و موجودی/g) || []).length < 4) errors.push('/catalog/: models without confirmed prices must use inquiry copy');
if (/ضمانت مرجوعی|۲۴ ساعته/.test(catalogHtml || '')) errors.push('/catalog/: unverified return policy must not be published');
const baleUrl = 'https://ble.ir/baran_towel_bathrobe';
if (!bridalHtml?.includes(`href="${baleUrl}"`)) errors.push('/bridal-towels/: verified Bale CTA is missing');
if ((catalogHtml?.match(new RegExp(`href="${baleUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')) || []).length < 6) errors.push('/catalog/: each product must offer the verified Bale inquiry channel');
if (!catalogHtml?.includes('/assets/products/mozhan.webp') || catalogHtml.includes('product-media--pending')) errors.push('/catalog/: confirmed Mozhan image must replace the pending placeholder');
if (catalogHtml?.includes('رار') || !catalogHtml?.includes('وستا، راد و ایلیا')) errors.push('/catalog/: corrected Rad model name is missing');

const sitemap = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf8');
for (const requiredRoute of ['/', '/bridal-towels/', '/catalog/', '/blog/', '/blog/rahnamaye-kharid-hole-luxury/', '/en/', '/en/catalog/', '/en/blog/', '/en/blog/how-to-choose-luxury-towels/']) {
  if (!sitemap.includes(`<loc>https://luxtowelco.com${requiredRoute}</loc>`)) errors.push(`sitemap missing ${requiredRoute}`);
}
for (const draftRoute of ['/bridal-towel-buying-guide/', '/how-to-choose-bridal-towel/', '/towel-set-for-dowry/', '/best-towel-material/', '/bridal-towel-vs-regular-towel/', '/towel-color-for-dowry/', '/bridal-towel-gift-guide/']) {
  if (sitemap.includes(draftRoute) || htmlByRoute.has(draftRoute)) errors.push(`unpublished article route leaked: ${draftRoute}`);
}

const expectedStatuses = new Map([
  ['/', 200], ['/bridal-towels/', 200], ['/catalog/', 200], ['/blog/', 200],
  ['/blog/rahnamaye-kharid-hole-luxury/', 200], ['/en/', 200], ['/en/catalog/', 200],
  ['/en/blog/', 200], ['/en/blog/how-to-choose-luxury-towels/', 200], ['/route-that-must-not-exist/', 404]
]);

for (const [route, expected] of expectedStatuses) {
  try {
    const response = await fetch(`${baseUrl}${route}`, { redirect: 'manual' });
    if (response.status !== expected) errors.push(`${route}: expected HTTP ${expected}, received ${response.status}`);
  } catch (error) {
    errors.push(`${route}: request failed (${error.message})`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ htmlFiles: htmlFiles.length, checkedRoutes: expectedStatuses.size, status: 'passed' }));
}
