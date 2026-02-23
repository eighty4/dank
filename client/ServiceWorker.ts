import website from 'DANK:sw'

declare const self: ServiceWorkerGlobalScope

self.addEventListener('install', (e: ExtendableEvent) =>
    e.waitUntil(populateCache()),
)

self.addEventListener('activate', (e: ExtendableEvent) =>
    e.waitUntil(cleanupCaches()),
)

self.addEventListener('fetch', (e: FetchEvent) =>
    e.respondWith(handleRequest(e.request)),
)

const PREFIX_APP_CACHE_KEY = 'DANK-website-'
const APP_CACHE_KEY: string = PREFIX_APP_CACHE_KEY + website.cacheKey

async function populateCache() {
    const cache = await self.caches.open(APP_CACHE_KEY)
    const previousCacheKey = await swapCurrentCacheKey()
    if (!previousCacheKey) {
        await cache.addAll(website.files)
    } else {
        const previousCache = await self.caches.open(previousCacheKey)
        await Promise.all(
            website.files.map(async f => {
                const previouslyCached = await previousCache.match(f)
                if (previouslyCached) {
                    await cache.put(f, previouslyCached)
                } else {
                    await cache.add(f)
                }
            }),
        )
    }
}

async function swapCurrentCacheKey(): Promise<string | null> {
    const META_CACHE_KEY = 'DANK-meta'
    const CACHE_KEY_URL = '/DANK/current'
    const metaCache = await self.caches.open(META_CACHE_KEY)
    const previousCacheKeyResponse = await metaCache.match(CACHE_KEY_URL)
    const previousCacheKey = previousCacheKeyResponse
        ? await previousCacheKeyResponse.text()
        : null
    await metaCache.put(
        CACHE_KEY_URL,
        new Response(APP_CACHE_KEY, {
            headers: {
                'Content-Type': 'text/plain',
            },
        }),
    )
    return previousCacheKey
}

async function cleanupCaches() {
    const cacheKeys = await self.caches.keys()
    for (const cacheKey of cacheKeys) {
        if (cacheKey !== APP_CACHE_KEY) {
            await self.caches.delete(cacheKey)
        }
    }
}

// todo implement page mapping url rewrites here
// url.pathname = mappedUrlPath
async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (req.method === 'GET' && !bypassCache(url)) {
        const cache = await caches.open(APP_CACHE_KEY)
        const fromCache = await cache.match(url)
        if (fromCache) {
            return fromCache
        }
    }
    return fetch(req)
}

// todo support RegExp
function bypassCache(url: URL): boolean {
    return (
        website.bypassCache?.hosts?.includes(url.host) ||
        website.bypassCache?.paths?.includes(url.pathname as `/${string}`) ||
        false
    )
}
