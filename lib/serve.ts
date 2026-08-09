import { rm } from 'node:fs/promises'
import { extname } from 'node:path'
import type { BuildContext } from 'esbuild'
import { bold, green, red } from './ansi.ts'
import { buildWebsite } from './build.ts'
import { loadConfig, type ResolvedDankConfig } from './config.ts'
import { createGlobalDefinitions } from './define.ts'
import { LOG } from './debug_log.ts'
import { esbuildDevContext } from './esbuild.ts'
import {
    createBuiltDistFilesFetcher,
    createBuiltDistHtmlFileFetcher,
    createDevServeFilesFetcher,
    startWebServer,
    type HtmlFileFetcher,
    type UrlRewriteProvider,
} from './http.ts'
import { WebsiteRegistry, type UrlRewrite } from './registry.ts'
import { DevServices } from './services.ts'
import { watch } from './watch.ts'

let c: ResolvedDankConfig

export async function serveWebsite(mode: 'preview' | 'serve'): Promise<never> {
    c = await loadConfig(mode, process.cwd())
    await rm(c.dirs.buildRoot, { force: true, recursive: true })
    if (c.isPreviewMode()) {
        await startPreviewMode()
    } else {
        await startDevMode()
    }
    return new Promise(() => {})
}

async function startPreviewMode() {
    const manifest = await buildWebsite(c)
    const frontend = createBuiltDistFilesFetcher(c.dirs, manifest)
    const devServices = launchDevServices()
    const urlRewrites: Array<UrlRewrite> = Object.keys(c.pages)
        .sort()
        .map(url => {
            const mapping = c.pages[url as `/${string}`]
            return typeof mapping !== 'object' || !mapping.pattern
                ? null
                : { url: url as `/${string}`, pattern: mapping.pattern }
        })
        .filter(mapping => mapping !== null)
    startWebServer(
        c,
        { urlRewrites } satisfies UrlRewriteProvider,
        frontend,
        createBuiltDistHtmlFileFetcher(c.dirs, manifest),
        devServices,
    )
    const controller = new AbortController()
    watch('dank.config.ts', controller.signal, async filename => {
        console.log(filename, 'was updated!')
        console.log('config updates are not hot reloaded during `dank preview`')
        console.log('restart DANK to reload configuration')
        controller.abort()
    })
}

type BuildContextState =
    BuildContext | 'starting' | 'dirty' | 'disposing' | null

async function startDevMode() {
    const registry = new WebsiteRegistry(c)
    const htmlFiles: Record<`/${string}`, string> = {}
    let buildContext: BuildContextState = null

    watch('dank.config.ts', async filename => {
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
        devServices.update(c.services)
    })

    watch(c.dirs.pages, { recursive: true }, filename => {
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
        html.on('error', e => {
            delete htmlFiles[html.url]
            console.log(red('error:'), e.message)
        })
        html.on('output', output => {
            htmlFiles[html.url] = output
            LOG({
                realm: 'serve',
                message: 'updating html output',
                data: {
                    url: html.url,
                    webpage: html.fsPath,
                },
            })
        })
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

    const htmlFetcher: HtmlFileFetcher = url =>
        Promise.resolve(htmlFiles[url] ?? null)
    const frontend = createDevServeFilesFetcher(
        c.esbuildPort,
        c.dirs,
        registry,
        htmlFetcher,
    )
    const devServices = launchDevServices()
    startWebServer(c, registry, frontend, htmlFetcher, devServices)
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

function launchDevServices(): DevServices {
    const services = new DevServices(c.services)
    services.on('error', (label, cause) =>
        console.log(formatServiceLabel(label), 'errored:', cause),
    )
    services.on('exit', (label, code) => {
        if (code) {
            console.log(formatServiceLabel(label), 'exited', code)
        } else {
            console.log(formatServiceLabel(label), 'exited')
        }
    })
    services.on('launch', label =>
        console.log(formatServiceLabel(label), 'starting'),
    )
    services.on('stdout', (label, output) =>
        printServiceOutput(label, green, output),
    )
    services.on('stderr', (label, output) =>
        printServiceOutput(label, red, output),
    )
    return services
}

function formatServiceLabel(label: string): string {
    return `${bold('|')} ${label} ${bold('|')}`
}

function formatServiceOutputLabel(
    label: string,
    color: (s: string) => string,
): string {
    return color(formatServiceLabel(label))
}

function printServiceOutput(
    label: string,
    color: (s: string) => string,
    output: Array<string>,
) {
    const formattedLabel = formatServiceOutputLabel(label, color)
    for (const line of output) console.log(formattedLabel, line)
}
