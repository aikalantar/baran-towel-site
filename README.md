# Baran towel website

Static, bilingual website for Baran, built with semantic HTML, shared CSS and minimal vanilla JavaScript.

## Canonical routes

- `/` and `/en/`
- `/bridal-towels/` (Persian bridal towel content hub)
- `/catalog/` and `/en/catalog/`
- `/blog/` and `/en/blog/`
- `/blog/rahnamaye-kharid-hole-luxury/`
- `/en/blog/how-to-choose-luxury-towels/`

The Persian `/catalog/` is the product-led bridal towel catalogue. The English catalogue remains the general image catalogue, so these two routes intentionally do not use `hreflang` alternates.

## Cloudflare Workers Static Assets

The only production directory is `public/`. Root `wrangler.jsonc` deploys that directory as Workers Static Assets. No build command or JavaScript framework is required.

- `public/_redirects` contains permanent path canonicalisation rules.
- `public/_headers` keeps HTML revalidating and applies immutable browser caching only to versioned assets.
- The `workers.dev` hostname receives `X-Robots-Tag: noindex`.
- Domain-level HTTP-to-HTTPS and `www`-to-apex redirects must be managed in the Cloudflare zone because Workers `_redirects` does not support domain-level rules.

## Asset updates

When CSS, JavaScript, icons or an image changes, give the output a new content hash or versioned filename and update every HTML reference before deployment. Never apply immutable caching to a mutable filename.

## Deployment

Pushes to `main` are deployed through the connected Cloudflare Git integration. Manual fallback:

```powershell
npx wrangler deploy
```

With the local static server running on port `4175`, run `node test/site-audit.mjs`. For responsive layout and interaction coverage, also run `node test/browser-smoke.mjs` while headless Chrome DevTools is available on port `9223`.
