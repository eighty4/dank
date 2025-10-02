import { mkdir, readFile, rm, watch as _watch } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import type { BuildContext } from 'esbuild'
import { buildWebsite } from './build.ts'
import { loadConfig } from './config.ts'
import type { DankConfig } from './dank.ts'
import { createGlobalDefinitions } from './define.ts'
import { esbuildDevContext } from './esbuild.ts'
import { isPreviewBuild } from './flags.ts'
import { HtmlEntrypoint } from './html.ts'
import {
    createBuiltDistFilesFetcher,
    createDevServeFilesFetcher,
    createWebServer,
} from './http.ts'
import { startDevServices, updateDevServices } from './services.ts'

const isPreview = isPreviewBuild()

// alternate port for --preview bc of service worker
const PORT = isPreview ? 4000 : 3000

// port for esbuild.serve
const ESBUILD_PORT = 2999

export async function serveWebsite(c: DankConfig): Promise<never> {
    await rm('build', { force: true, recursive: true })
    if (isPreview) {
        await startPreviewMode(c)
    } else {
        const abortController = new AbortController()
        await startDevMode(c, abortController.signal)
    }
    return new Promise(() => {})
}

async function startPreviewMode(c: DankConfig) {
    const { dir, files } = await buildWebsite(c)
    const frontend = createBuiltDistFilesFetcher(dir, files)
    createWebServer(PORT, frontend).listen(PORT)
    console.log(`preview is live at http://127.0.0.1:${PORT}`)
}

// todo changing partials triggers update on html pages
// todo proxy to esbuild handles `failed to fetch` with retry interval and 504 timeout
async function startDevMode(c: DankConfig, signal: AbortSignal) {
    const watchDir = join('build', 'watch')
    await mkdir(watchDir, { recursive: true })
    const clientJS = await loadClientJS()
    const pagesByUrlPath: Record<string, WebpageMetadata> = {}
    const entryPointsByUrlPath: Record<string, Set<string>> = {}
    let buildContext: BuildContext | 'starting' | 'dirty' | 'disposing' | null =
        null

    watch('dank.config.ts', signal, async () => {
        let updated: DankConfig
        try {
            updated = await loadConfig()
        } catch (ignore) {
            return
        }
        const prevPages = new Set(Object.keys(pagesByUrlPath))
        await Promise.all(
            Object.entries(updated.pages).map(async ([urlPath, srcPath]) => {
                c.pages[urlPath as `/${string}`] = srcPath
                if (pagesByUrlPath[urlPath]) {
                    prevPages.delete(urlPath)
                    if (pagesByUrlPath[urlPath].srcPath !== srcPath) {
                        await updatePage(urlPath)
                    }
                } else {
                    await addPage(urlPath, srcPath)
                }
            }),
        )
        for (const prevPage of Array.from(prevPages)) {
            delete c.pages[prevPage as `/${string}`]
            deletePage(prevPage)
        }
        updateDevServices(updated)
    })

    watch('pages', signal, filename => {
        if (extname(filename) === '.html') {
            for (const [urlPath, srcPath] of Object.entries(c.pages)) {
                if (srcPath === filename) {
                    updatePage(urlPath)
                }
            }
        }
    })

    await Promise.all(
        Object.entries(c.pages).map(([urlPath, srcPath]) =>
            addPage(urlPath, srcPath),
        ),
    )

    async function addPage(urlPath: string, srcPath: string) {
        const metadata = await processWebpage({
            clientJS,
            outDir: watchDir,
            pagesDir: 'pages',
            srcPath,
            urlPath,
        })
        pagesByUrlPath[urlPath] = metadata
        entryPointsByUrlPath[urlPath] = new Set(
            metadata.entryPoints.map(e => e.in),
        )
        if (buildContext !== null) {
            resetBuildContext()
        }
    }

    function deletePage(urlPath: string) {
        delete pagesByUrlPath[urlPath]
        delete entryPointsByUrlPath[urlPath]
        resetBuildContext()
    }

    async function updatePage(urlPath: string) {
        const update = await processWebpage({
            clientJS,
            outDir: watchDir,
            pagesDir: 'pages',
            srcPath: c.pages[urlPath as `/${string}`],
            urlPath,
        })
        const entryPointUrls = new Set(update.entryPoints.map(e => e.in))
        if (!hasSameValues(entryPointUrls, entryPointsByUrlPath[urlPath])) {
            entryPointsByUrlPath[urlPath] = entryPointUrls
            resetBuildContext()
        }
    }

    function collectEntrypoints(): Array<{ in: string; out: string }> {
        const sources: Set<string> = new Set()
        return Object.values(pagesByUrlPath)
            .flatMap(({ entryPoints }) => entryPoints)
            .filter(entryPoint => {
                if (sources.has(entryPoint.in)) {
                    return false
                } else {
                    sources.add(entryPoint.in)
                    return true
                }
            })
    }

    function resetBuildContext() {
        if (buildContext === 'starting' || buildContext === 'dirty') {
            buildContext = 'dirty'
            return
        }
        if (buildContext === 'disposing') {
            return
        }
        if (buildContext !== null) {
            const prev = buildContext
            buildContext = 'disposing'
            prev.dispose().then(() => {
                buildContext = null
                resetBuildContext()
            })
        } else {
            startEsbuildWatch(collectEntrypoints()).then(ctx => {
                if (buildContext === 'dirty') {
                    buildContext = null
                    resetBuildContext()
                } else {
                    buildContext = ctx
                }
            })
        }
    }

    buildContext = await startEsbuildWatch(collectEntrypoints())
    const frontend = createDevServeFilesFetcher({
        pages: c.pages,
        pagesDir: watchDir,
        proxyPort: ESBUILD_PORT,
        publicDir: 'public',
    })
    createWebServer(PORT, frontend).listen(PORT)
    console.log(`dev server is live at http://127.0.0.1:${PORT}`)
    startDevServices(c, signal)
}

function hasSameValues(a: Set<string>, b: Set<string>): boolean {
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

type WebpageInputs = {
    clientJS: string
    outDir: string
    pagesDir: string
    srcPath: string
    urlPath: string
}

type WebpageMetadata = {
    entryPoints: Array<{ in: string; out: string }>
    srcPath: string
    urlPath: string
}

async function processWebpage(inputs: WebpageInputs): Promise<WebpageMetadata> {
    const html = await HtmlEntrypoint.readFrom(
        inputs.urlPath,
        join(inputs.pagesDir, inputs.srcPath),
    )
    await html.injectPartials()
    if (inputs.urlPath !== '/') {
        await mkdir(join(inputs.outDir, inputs.urlPath), { recursive: true })
    }
    const entryPoints: Array<{ in: string; out: string }> = []
    html.collectScripts().forEach(scriptImport => {
        entryPoints.push({
            in: scriptImport.in,
            out: scriptImport.out,
        })
    })
    html.rewriteHrefs()
    html.appendScript(inputs.clientJS)
    await html.writeTo(inputs.outDir)
    return {
        entryPoints,
        srcPath: inputs.srcPath,
        urlPath: inputs.urlPath,
    }
}

async function startEsbuildWatch(
    entryPoints: Array<{ in: string; out: string }>,
): Promise<BuildContext> {
    const ctx = await esbuildDevContext(
        createGlobalDefinitions(),
        entryPoints,
        'build/watch',
    )

    await ctx.watch()

    await ctx.serve({
        host: '127.0.0.1',
        port: ESBUILD_PORT,
        cors: {
            origin: 'http://127.0.0.1:' + PORT,
        },
    })

    return ctx
}

async function loadClientJS() {
    return await readFile(
        resolve(import.meta.dirname, join('..', 'client', 'esbuild.js')),
        'utf-8',
    )
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
