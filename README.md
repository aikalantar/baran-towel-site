# تولیدی حوله باران

Static website for Baran towel production, including product galleries, Baran catalog designs, and 2024/2026 catalog pages.

## Cloudflare Pages

- Build command: leave empty
- Build output directory: `public`
- Root directory: `/`

The site is plain HTML, CSS, and JavaScript, so it does not need an install or build step.

## Cloudflare Workers Static Assets

The deployable site is isolated in `public/`. `wrangler.jsonc` points Cloudflare to that folder so repository metadata such as `.git/` is never uploaded as a static asset.
