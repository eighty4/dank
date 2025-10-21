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
import { esbuildDevContext } from './esbuild.ts'
import { dankPort, esbuildPort, isPreviewBuild } from './flags.ts'
import { HtmlEntrypoint } from './html.ts'
import {
    createBuiltDistFilesFetcher,
    createDevServeFilesFetcher,
    createWebServer,
} from './http.ts'
import { startDevServices, updateDevServices } from './services.ts'

const isPreview = isPreviewBuild()

// alternate port for --preview bc of service worker
const PORT = dankPort() || (isPreview ? 4000 : 3000)

// port for esbuild.serve
const ESBUILD_PORT = esbuildPort() || 3995

export async function serveWebsite(c: DankConfig): Promise<never> {
    await rm('build', { force: true, recursive: true })
    const abortController = new AbortController()
    process.once('exit', () => abortController.abort())
    if (isPreview) {
        await startPreviewMode(c, abortController.signal)
    } else {
        await startDevMode(c, abortController.signal)
    }
    return new Promise(() => {})
}

async function startPreviewMode(c: DankConfig, signal: AbortSignal) {
    const { dir, files } = await buildWebsite(c)
    const frontend = createBuiltDistFilesFetcher(dir, files)
    const devServices = startDevServices(c, signal)
    createWebServer(PORT, frontend, devServices.http).listen(PORT)
    console.log(`preview is live at http://127.0.0.1:${PORT}`)
}

type BuildContextState =
    | BuildContext
    | 'starting'
    | 'dirty'
    | 'disposing'
    | 'preparing'
    | null

// todo changing partials triggers update on html pages
async function startDevMode(c: DankConfig, signal: AbortSignal) {
    const watchDir = join('build', 'watch')
    await mkdir(watchDir, { recursive: true })
    const clientJS = await loadClientJS()
    const pagesByUrlPath: Record<string, HtmlEntrypoint> = {}
    const partialsByUrlPath: Record<string, Array<string>> = {}
    const entryPointsByUrlPath: Record<
        string,
        {
            entrypoints: Array<{ in: string; out: string }>
            pathsIn: Set<string>
        }
    > = {}
    let buildContext: BuildContextState = 'preparing'

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

    watch('pages', signal, filename => {
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
        Object.entries(c.pages).map(async ([urlPath, srcPath]) => {
            await addPage(urlPath, srcPath)
            return new Promise(res =>
                pagesByUrlPath[urlPath].once('entrypoints', res),
            )
        }),
    )

    async function addPage(urlPath: string, srcPath: string) {
        await mkdir(join(watchDir, urlPath), { recursive: true })
        const htmlEntrypoint = (pagesByUrlPath[urlPath] = new HtmlEntrypoint(
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
            writeFile(join(watchDir, urlPath, 'index.html'), html),
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

    function collectEntrypoints(): Array<{ in: string; out: string }> {
        const unique: Set<string> = new Set()
        return Object.values(entryPointsByUrlPath)
            .flatMap(entrypointState => entrypointState.entrypoints)
            .filter(entryPoint => {
                if (unique.has(entryPoint.in)) {
                    return false
                } else {
                    unique.add(entryPoint.in)
                    return true
                }
            })
    }

    function resetBuildContext() {
        if (buildContext === 'preparing' || buildContext === 'disposing') {
            return
        }
        if (buildContext === 'starting' || buildContext === 'dirty') {
            buildContext = 'dirty'
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

    buildContext = await startEsbuildWatch(collectEntrypoints())
    const frontend = createDevServeFilesFetcher({
        pages: c.pages,
        pagesDir: watchDir,
        proxyPort: ESBUILD_PORT,
        publicDir: 'public',
    })
    const devServices = startDevServices(c, signal)
    createWebServer(PORT, frontend, devServices.http).listen(PORT)
    console.log(`dev server is live at http://127.0.0.1:${PORT}`)
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
    const clientJS = await readFile(
        resolve(import.meta.dirname, join('..', 'client', 'esbuild.js')),
        'utf-8',
    )
    return clientJS.replace('3995', `${ESBUILD_PORT}`)
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
