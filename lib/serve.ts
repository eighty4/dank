import { mkdir, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { BuildContext } from 'esbuild'
import { buildWebsite } from './build.ts'
import { loadConfig, type ResolvedDankConfig } from './config.ts'
import { createGlobalDefinitions } from './define.ts'
import { LOG } from './developer.ts'
import { esbuildDevContext } from './esbuild.ts'
import type { HtmlEntrypoint } from './html.ts'
import {
    createBuiltDistFilesFetcher,
    createDevServeFilesFetcher,
    startWebServer,
} from './http.ts'
import { WebsiteRegistry, type UrlRewrite } from './registry.ts'
import { startDevServices, updateDevServices } from './services.ts'
import { watch } from './watch.ts'

let c: ResolvedDankConfig

export async function serveWebsite(): Promise<never> {
    c = await loadConfig('serve', process.cwd())
    await rm(c.dirs.buildRoot, { force: true, recursive: true })
    const abortController = new AbortController()
    process.once('exit', () => abortController.abort())
    if (c.flags.preview) {
        await startPreviewMode(abortController.signal)
    } else {
        await startDevMode(abortController.signal)
    }
    return new Promise(() => {})
}

async function startPreviewMode(signal: AbortSignal) {
    const manifest = await buildWebsite(c)
    const frontend = createBuiltDistFilesFetcher(c.dirs, manifest)
    const devServices = startDevServices(c.services, signal)
    const urlRewrites: Array<UrlRewrite> = Object.keys(c.pages)
        .sort()
        .map(url => {
            const mapping = c.pages[url as `/${string}`]
            return typeof mapping !== 'object' || !mapping.pattern
                ? null
                : { url, pattern: mapping.pattern }
        })
        .filter(mapping => mapping !== null)
    startWebServer(
        c.dankPort,
        c.flags,
        c.dirs,
        { urlRewrites },
        frontend,
        devServices.http,
    )
}

type BuildContextState =
    | BuildContext
    | 'starting'
    | 'dirty'
    | 'disposing'
    | null

async function startDevMode(signal: AbortSignal) {
    const registry = new WebsiteRegistry(c)
    await mkdir(c.dirs.buildWatch, { recursive: true })
    let buildContext: BuildContextState = null

    watch('dank.config.ts', signal, async filename => {
        LOG({
            realm: 'serve',
            message: 'config watch event',
            data: {
                file: filename,
            },
        })
        try {
            await c.reload()
        } catch (ignore) {
            return
        }
        registry.configSync()
        updateDevServices(c.services)
    })

    watch(c.dirs.pages, signal, filename => {
        LOG({
            realm: 'serve',
            message: 'pages dir watch event',
            data: {
                file: filename,
            },
        })
        if (extname(filename) === '.html') {
            registry.htmlEntrypoints.forEach(html => {
                if (html.fsPath === filename) {
                    html.emit('change')
                } else if (html.usesPartial(filename)) {
                    html.emit('change', filename)
                }
            })
        }
    })

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
            LOG({ realm: 'serve', message: 'disposing esbuild context' })
            const disposing = buildContext.dispose()
            buildContext = 'disposing'
            disposing.then(() => {
                buildContext = null
                resetBuildContext()
            })
        } else {
            buildContext = 'starting'
            startEsbuildWatch(registry).then(ctx => {
                if (buildContext === 'dirty') {
                    buildContext = 'disposing'
                    ctx.dispose().then(() => {
                        buildContext = null
                        resetBuildContext()
                    })
                } else {
                    buildContext = ctx
                }
            })
        }
    }

    registry.on('webpage', html => {
        html.on('error', e =>
            console.log(`\u001b[31merror:\u001b[0m`, e.message),
        )
        html.on('output', output => writeHtml(html, output))
    })

    registry.on('workers', () => {
        LOG({
            realm: 'serve',
            message: 'registry updated worker entrypoints',
            data: {
                workers: registry.workerEntryPoints?.map(ep => ep.in) || null,
            },
        })
        resetBuildContext()
    })

    registry.configSync()
    await Promise.all(registry.htmlEntrypoints.map(html => html.process()))

    // listen for entrypoint diffs after processing webpages
    registry.on('entrypoints', () => resetBuildContext())

    // inital start of esbuild ctx
    resetBuildContext()

    const frontend = createDevServeFilesFetcher(c.esbuildPort, c.dirs, registry)
    const devServices = startDevServices(c.services, signal)
    startWebServer(
        c.dankPort,
        c.flags,
        c.dirs,
        registry,
        frontend,
        devServices.http,
    )
}

async function startEsbuildWatch(
    registry: WebsiteRegistry,
): Promise<BuildContext> {
    const entryPoints = registry.webpageAndWorkerEntryPoints
    LOG({
        realm: 'serve',
        message: 'starting esbuild watch',
        data: {
            entrypoints: entryPoints.map(ep => ep.in),
        },
    })
    const ctx = await esbuildDevContext(
        registry,
        createGlobalDefinitions(c),
        entryPoints,
    )

    await ctx.watch()

    await ctx.serve({
        host: '127.0.0.1',
        port: c.esbuildPort,
        cors: {
            origin: ['127.0.0.1', 'localhost'].map(
                hostname => `http://${hostname}:${c.dankPort}`,
            ),
        },
    })

    return ctx
}

async function writeHtml(html: HtmlEntrypoint, output: string) {
    const dir = join(c.dirs.buildWatch, html.url)
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'index.html')
    LOG({
        realm: 'serve',
        message: 'writing html output',
        data: {
            webpage: html.fsPath,
            path,
        },
    })
    await writeFile(path, output)
}
