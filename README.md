# Build DANK webpages

DANK has some perks:

- Webpage-first development for multi-page websites
- Code splitting via `esbuild` bundler across all webpages
- `dank serve` updates CSS in real-time (hot-reloading)
- `dank serve` launches development processes and merges their stdio
- `dank serve --preview` builds the website and serves the output from `dist`
- `dank build --production` optimizes with `esbuild` minifying and tree-shaking
- DANK's codebase is so tiny you can read it all in 20 mins

DANK isn't for every use case.
[Vite](https://vite.dev) is the right move for building a Single-Page Application.
For SEO optimizing dynamic content with Server-Side Rendering,
check out [Next.js](https://nextjs.org) or [Astro](https://astro.build).

DANK is an ideal choice for building multi-page websites deployed to a CDN.

## Getting started

```
bun create dank --out-dir www

npm create dank -- --out-dir www

pnpm create dank --out-dir www
```

## `dank.config.ts` examples

Webpages and their URLs are configured explicitly to keep your URLs
and workspace organized independently:

```typescript
import { defineConfig } from '@eighty4/dank'

export default defineConfig({
    pages: {
        '/': './home.html',
    },
})
```

Streamline development with `dank serve` launching API when starting your dev server:

```typescript
import { defineConfig } from '@eighty4/dank'

export default defineConfig({
    pages: {
        '/': './home.html',
    },
    services: [
        {
            command: 'node --watch --env-file-if-exists=.env.dev server.ts',
            cwd: './api',
        },
    ],
})
```
