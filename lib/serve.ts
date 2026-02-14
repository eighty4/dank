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
import { DevServices, type ManagedServiceLabel } from './services.ts'
import { watch } from './watch.ts'

let c: ResolvedDankConfig

export async function serveWebsite(): Promise<never> {
    c = await loadConfig('serve', process.cwd())
    await rm(c.dirs.buildRoot, { force: true, recursive: true })
    if (c.flags.preview) {
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
                : { url, pattern: mapping.pattern }
        })
        .filter(mapping => mapping !== null)
    startWebServer(
        c.dankPort,
        c.flags,
        c.dirs,
        { urlRewrites },
        frontend,
        devServices,
    )
}

type BuildContextState =
    | BuildContext
    | 'starting'
    | 'dirty'
    | 'disposing'
    | null

async function startDevMode() {
    const registry = new WebsiteRegistry(c)
    await mkdir(c.dirs.buildWatch, { recursive: true })
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

    watch(c.dirs.pages, filename => {
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
    const devServices = launchDevServices()
    startWebServer(c.dankPort, c.flags, c.dirs, registry, frontend, devServices)
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
        printServiceOutput(label, 32, output),
    )
    services.on('stderr', (label, output) =>
        printServiceOutput(label, 31, output),
    )
    return services
}

function formatServiceLabel(label: ManagedServiceLabel): string {
    return `| \u001b[2m${label.cwd}\u001b[22m ${label.command} |`
}

function formatServiceOutputLabel(
    label: ManagedServiceLabel,
    color: 31 | 32,
): string {
    return `\u001b[${color}m${formatServiceLabel(label)}\u001b[39m`
}

function printServiceOutput(
    label: ManagedServiceLabel,
    color: 31 | 32,
    output: Array<string>,
) {
    const formattedLabel = formatServiceOutputLabel(label, color)
    for (const line of output) console.log(formattedLabel, line)
}
