import { extname, join } from 'node:path'
import type { BuildContext } from 'esbuild'
import { red } from './ansi.ts'
import { type ResolvedDankConfig } from './config.ts'
import { createGlobalDefinitions } from './define.ts'
import { LOG } from './debug_log.ts'
import { esbuildDevContext } from './esbuild.ts'
import { startWebServer } from './http.ts'
import { WebsiteRegistry } from './registry.ts'
import { DevServices } from './services.ts'
import { configureDevServicesOutput } from './services_output.ts'
import { watch, type WatchEventKind } from './watch.ts'

let c: ResolvedDankConfig

export async function serveWebsite(
    initialC: ResolvedDankConfig,
): Promise<never> {
    c = initialC
    await startDevMode()
    return new Promise(() => {})
}

type BuildContextState =
    BuildContext | 'starting' | 'dirty' | 'disposing' | null

async function startDevMode() {
    const registry = new WebsiteRegistry(c)
    const devServices = new DevServices()
    const htmlFiles: Record<`/${string}`, string> = {}
    let buildContext: BuildContextState = null

    watch(join(c.dirs.projectRootAbs, 'dank.config.ts'), filename =>
        onConfigUpdate(filename),
    )

    watch(c.dirs.pagesAbs, { recursive: true }, (filename, event) => {
        if (extname(filename) === '.html') {
            onHtmlChange(filename, event)
        }
    })

    async function onConfigUpdate(filename: string) {
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
    }

    function onHtmlChange(filename: string, event: WatchEventKind) {
        LOG({
            realm: 'serve',
            message: 'pages dir watch event',
            data: {
                file: filename,
                event,
            },
        })
        if (event === 'remove') {
            for (const pageUrl of registry.pageUrlsForHtmlFsPath(filename)) {
                delete htmlFiles[pageUrl]
            }
        } else {
            registry.htmlModified(filename)
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

    registry.on('webpage-removed', url => {
        delete htmlFiles[url]
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

    configureDevServicesOutput(devServices)
    devServices.start(c.services)
    startWebServer(c, {
        devServices,
        htmlFiles: url => htmlFiles[url] ?? null,
    })
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
