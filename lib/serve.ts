import {
    mkdir,
    readFile,
    rm,
    watch as _watch,
    writeFile,
} from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import type { BuildContext } from 'esbuild'
import { buildWebsite } from './build.ts'
import { loadConfig } from './config.ts'
import type { DankConfig } from './dank.ts'
import { createGlobalDefinitions } from './define.ts'
import { esbuildDevContext, type EntryPoint } from './esbuild.ts'
import { resolveServeFlags, type DankServe } from './flags.ts'
import { HtmlEntrypoint } from './html.ts'
import {
    createBuiltDistFilesFetcher,
    createDevServeFilesFetcher,
    startWebServer,
    type PageRouteState,
    type UrlRewrite,
} from './http.ts'
import { WebsiteRegistry } from './metadata.ts'
import { startDevServices, updateDevServices } from './services.ts'

export async function serveWebsite(c: DankConfig): Promise<never> {
    const serve = resolveServeFlags(c)
    await rm(serve.dirs.buildRoot, { force: true, recursive: true })
    const abortController = new AbortController()
    process.once('exit', () => abortController.abort())
    if (serve.preview) {
        await startPreviewMode(c, serve, abortController.signal)
    } else {
        await startDevMode(c, serve, abortController.signal)
    }
    return new Promise(() => {})
}

async function startPreviewMode(
    c: DankConfig,
    serve: DankServe,
    signal: AbortSignal,
) {
    const manifest = await buildWebsite(c, serve)
    const frontend = createBuiltDistFilesFetcher(serve.dirs.buildDist, manifest)
    const devServices = startDevServices(c, signal)
    startWebServer(serve, frontend, devServices.http, {
        urls: Object.keys(c.pages),
        urlRewrites: collectUrlRewrites(c),
    })
}

function collectUrlRewrites(c: DankConfig): Array<UrlRewrite> {
    return Object.keys(c.pages)
        .sort()
        .map(url => {
            const mapping = c.pages[url as `/${string}`]
            return typeof mapping !== 'object' || !mapping.pattern
                ? null
                : { url, pattern: mapping.pattern }
        })
        .filter(mapping => mapping !== null)
}

type BuildContextState =
    | BuildContext
    | 'starting'
    | 'dirty'
    | 'disposing'
    | null

type EntrypointsState = {
    entrypoints: Array<EntryPoint>
    pathsIn: Set<string>
}

// todo changing partials triggers update on html pages
async function startDevMode(
    c: DankConfig,
    serve: DankServe,
    signal: AbortSignal,
) {
    await mkdir(serve.dirs.buildWatch, { recursive: true })
    const registry = new WebsiteRegistry(serve)
    const clientJS = await loadClientJS(serve.esbuildPort)
    const pagesByUrlPath: Record<string, HtmlEntrypoint> = {}
    const partialsByUrlPath: Record<string, Array<string>> = {}
    const entryPointsByUrlPath: Record<string, EntrypointsState> = {}
    let buildContext: BuildContextState = null

    registry.on('workers', resetBuildContext)

    watch('dank.config.ts', signal, async () => {
        let updated: DankConfig
        try {
            updated = await loadConfig()
        } catch (ignore) {
            return
        }
        const prevPages = new Set(Object.keys(pagesByUrlPath))
        await Promise.all(
            Object.entries(updated.pages).map(async ([urlPath, mapping]) => {
                c.pages[urlPath as `/${string}`] = mapping
                const srcPath =
                    typeof mapping === 'string' ? mapping : mapping.webpage
                if (!pagesByUrlPath[urlPath]) {
                    await addPage(urlPath, srcPath)
                } else {
                    prevPages.delete(urlPath)
                    if (pagesByUrlPath[urlPath].fsPath !== srcPath) {
                        await updatePage(urlPath)
                    }
                }
            }),
        )
        for (const prevPage of Array.from(prevPages)) {
            delete c.pages[prevPage as `/${string}`]
            deletePage(prevPage)
        }
        updateDevServices(updated)
    })

    watch(serve.dirs.pages, signal, filename => {
        if (extname(filename) === '.html') {
            for (const [urlPath, srcPath] of Object.entries(c.pages)) {
                if (srcPath === filename) {
                    updatePage(urlPath)
                }
            }
            for (const [urlPath, partials] of Object.entries(
                partialsByUrlPath,
            )) {
                if (partials.includes(filename)) {
                    updatePage(urlPath, filename)
                }
            }
        }
    })

    await Promise.all(
        Object.entries(c.pages).map(async ([urlPath, mapping]) => {
            const srcPath =
                typeof mapping === 'string' ? mapping : mapping.webpage
            await addPage(urlPath, srcPath)
            return new Promise(res =>
                pagesByUrlPath[urlPath].once('entrypoints', res),
            )
        }),
    )

    async function addPage(urlPath: string, srcPath: string) {
        await mkdir(join(serve.dirs.buildWatch, urlPath), { recursive: true })
        const htmlEntrypoint = (pagesByUrlPath[urlPath] = new HtmlEntrypoint(
            serve,
            registry.resolver,
            urlPath,
            srcPath,
            [{ type: 'script', js: clientJS }],
        ))
        htmlEntrypoint.on('entrypoints', entrypoints => {
            const pathsIn = new Set(entrypoints.map(e => e.in))
            if (
                !entryPointsByUrlPath[urlPath] ||
                !matchingEntrypoints(
                    entryPointsByUrlPath[urlPath].pathsIn,
                    pathsIn,
                )
            ) {
                entryPointsByUrlPath[urlPath] = { entrypoints, pathsIn }
                resetBuildContext()
            }
        })
        htmlEntrypoint.on('partial', partial => {
            if (!partialsByUrlPath[urlPath]) {
                partialsByUrlPath[urlPath] = []
            }
            partialsByUrlPath[urlPath].push(partial)
        })
        htmlEntrypoint.on(
            'partials',
            partials => (partialsByUrlPath[urlPath] = partials),
        )
        htmlEntrypoint.on('output', html =>
            writeFile(join(serve.dirs.buildWatch, urlPath, 'index.html'), html),
        )
    }

    function deletePage(urlPath: string) {
        pagesByUrlPath[urlPath].removeAllListeners()
        delete pagesByUrlPath[urlPath]
        delete entryPointsByUrlPath[urlPath]
        resetBuildContext()
    }

    async function updatePage(urlPath: string, partial?: string) {
        pagesByUrlPath[urlPath].emit('change', partial)
    }

    function collectEntrypoints(): Array<EntryPoint> {
        const unique: Set<string> = new Set()
        const pageBundles = Object.values(entryPointsByUrlPath)
            .flatMap(entrypointState => entrypointState.entrypoints)
            .filter(entryPoint => {
                if (unique.has(entryPoint.in)) {
                    return false
                } else {
                    unique.add(entryPoint.in)
                    return true
                }
            })
        const workerBundles = registry.workerEntryPoints()
        if (workerBundles) {
            return [...pageBundles, ...workerBundles]
        } else {
            return pageBundles
        }
    }

    function resetBuildContext() {
        switch (buildContext) {
            case 'starting':
                buildContext = 'dirty'
                return
            case 'dirty':
            case 'disposing':
                return
        }
        if (buildContext !== null) {
            const disposing = buildContext.dispose()
            buildContext = 'disposing'
            disposing.then(() => {
                buildContext = null
                resetBuildContext()
            })
        } else {
            buildContext = 'starting'
            startEsbuildWatch(c, registry, serve, collectEntrypoints()).then(
                ctx => {
                    if (buildContext === 'dirty') {
                        buildContext = 'disposing'
                        ctx.dispose().then(() => {
                            buildContext = null
                            resetBuildContext()
                        })
                    } else {
                        buildContext = ctx
                    }
                },
            )
        }
    }

    // function removePartialFromPage(partial: string, urlPath: string) {
    //     const deleteIndex = urlPathsByPartials[partial].indexOf(urlPath)
    //     if (deleteIndex !== -1) {
    //         if (urlPathsByPartials[partial].length === 1) {
    //             delete urlPathsByPartials[partial]
    //         } else {
    //             urlPathsByPartials[partial].splice(deleteIndex, 1)
    //         }
    //     }
    // }

    // inital start of esbuild ctx
    resetBuildContext()

    // todo this page route state could be built on change and reused
    const pageRoutes: PageRouteState = {
        get urls(): Array<string> {
            return Object.keys(c.pages)
        },
        get urlRewrites(): Array<UrlRewrite> {
            return collectUrlRewrites(c)
        },
    }
    const frontend = createDevServeFilesFetcher(pageRoutes, serve)
    const devServices = startDevServices(c, signal)
    startWebServer(serve, frontend, devServices.http, pageRoutes)
}

function matchingEntrypoints(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) {
        return false
    }
    for (const v in a) {
        if (!b.has(v)) {
            return false
        }
    }
    return true
}

async function startEsbuildWatch(
    c: DankConfig,
    registry: WebsiteRegistry,
    serve: DankServe,
    entryPoints: Array<EntryPoint>,
): Promise<BuildContext> {
    const ctx = await esbuildDevContext(
        serve,
        registry,
        createGlobalDefinitions(serve),
        entryPoints,
        c.esbuild,
    )

    await ctx.watch()

    await ctx.serve({
        host: '127.0.0.1',
        port: serve.esbuildPort,
        cors: {
            origin: ['127.0.0.1', 'localhost'].map(
                hostname => `http://${hostname}:${serve.dankPort}`,
            ),
        },
    })

    return ctx
}

async function loadClientJS(esbuildPort: number) {
    const clientJS = await readFile(
        resolve(import.meta.dirname, join('..', 'client', 'esbuild.js')),
        'utf-8',
    )
    return clientJS.replace('3995', `${esbuildPort}`)
}

async function watch(
    p: string,
    signal: AbortSignal,
    fire: (filename: string) => void,
) {
    const delayFire = 90
    const timeout = 100
    let changes: Record<string, number> = {}
    try {
        for await (const { filename } of _watch(p, {
            recursive: true,
            signal,
        })) {
            if (filename) {
                if (!changes[filename]) {
                    const now = Date.now()
                    changes[filename] = now + delayFire
                    setTimeout(() => {
                        const now = Date.now()
                        for (const [filename, then] of Object.entries(
                            changes,
                        )) {
                            if (then <= now) {
                                fire(filename)
                                delete changes[filename]
                            }
                        }
                    }, timeout)
                }
            }
        }
    } catch (e: any) {
        if (e.name !== 'AbortError') {
            throw e
        }
    }
}
