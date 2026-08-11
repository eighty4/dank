import { rm } from 'fs/promises'
import { buildWebsite } from './build.ts'
import { type ResolvedDankConfig } from './config.ts'
import {
    createBuiltDistFilesFetcher,
    createBuiltDistHtmlFileFetcher,
    startWebServer,
    type UrlRewriteProvider,
} from './http.ts'
import { type UrlRewrite } from './registry.ts'
import { DevServices } from './services.ts'
import { configureDevServicesOutput } from './services_output.ts'
import { watch } from './watch.ts'

export async function servePreview(c: ResolvedDankConfig): Promise<never> {
    await rm(c.dirs.buildRoot, { force: true, recursive: true })
    await startPreviewMode(c)
    return new Promise(() => {})
}

async function startPreviewMode(c: ResolvedDankConfig) {
    const manifest = await buildWebsite(c)
    const frontend = createBuiltDistFilesFetcher(c.dirs, manifest)
    const devServices = new DevServices()
    configureDevServicesOutput(devServices)
    devServices.start(c.services)
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
