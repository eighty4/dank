import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { buildWebsite } from './build.ts'
import { type ResolvedDankConfig } from './config.ts'
import { startWebServer } from './http.ts'
import { DevServices } from './services.ts'
import { configureDevServicesOutput } from './services_output.ts'
import { watch } from './watch.ts'

export async function servePreview(c: ResolvedDankConfig): Promise<never> {
    await rm(c.dirs.buildRoot, { force: true, recursive: true })
    await startPreviewMode(c)
    return new Promise(() => {})
}

async function startPreviewMode(c: ResolvedDankConfig) {
    await buildWebsite(c)
    if (c.services?.length) {
        const devServices = new DevServices()
        configureDevServicesOutput(devServices)
        devServices.start(c.services)
        startWebServer(c, { devServices })
    } else {
        startWebServer(c)
    }
    const controller = new AbortController()
    watch(
        join(c.dirs.projectRootAbs, 'dank.config.ts'),
        controller.signal,
        async (filename, kind) => {
            console.log(`${filename} was ${kind}!`)
            console.log(
                'config updates are not hot reloaded during `dank preview`',
            )
            console.log('restart DANK to reload configuration')
            controller.abort()
        },
    )
}
