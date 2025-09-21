import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { buildWebsite } from './build.ts'
import type { DankConfig } from './dank.ts'
import { createGlobalDefinitions } from './define.ts'
import { esbuildDevContext } from './esbuild.ts'
import { isPreviewBuild } from './flags.ts'
import { HtmlEntrypoint } from './html.ts'
import {
    createBuiltDistFilesFetcher,
    createLocalProxyFilesFetcher,
    createWebServer,
    type FrontendFetcher,
} from './http.ts'
import { copyAssets } from './public.ts'
import { startDevServices } from './services.ts'

const isPreview = isPreviewBuild()

// alternate port for --preview bc of service worker
const PORT = isPreview ? 4000 : 3000

// port for esbuild.serve
const ESBUILD_PORT = 2999

export async function serveWebsite(c: DankConfig): Promise<never> {
    await rm('build', { force: true, recursive: true })
    let frontend: FrontendFetcher
    if (isPreview) {
        const { dir, files } = await buildWebsite(c)
        frontend = createBuiltDistFilesFetcher(dir, files)
    } else {
        const { port } = await startEsbuildWatch(c)
        frontend = createLocalProxyFilesFetcher(port)
    }
    createWebServer(PORT, frontend).listen(PORT)
    console.log(
        isPreview ? 'preview' : 'dev server',
        `is live at http://127.0.0.1:${PORT}`,
    )
    startDevServices(c)
    return new Promise(() => {})
}

async function startEsbuildWatch(c: DankConfig): Promise<{ port: number }> {
    const watchDir = join('build', 'watch')
    await mkdir(watchDir, { recursive: true })
    await copyAssets(watchDir)

    const entryPointUrls: Set<string> = new Set()
    const entryPoints: Array<{ in: string; out: string }> = []

    await Promise.all(
        Object.entries(c.pages).map(async ([url, srcPath]) => {
            const html = await HtmlEntrypoint.readFrom(
                url,
                join('pages', srcPath),
            )
            await html.injectPartials()
            if (url !== '/') {
                await mkdir(join(watchDir, url), { recursive: true })
            }
            html.collectScripts()
                .filter(scriptImport => !entryPointUrls.has(scriptImport.in))
                .forEach(scriptImport => {
                    entryPointUrls.add(scriptImport.in)
                    entryPoints.push({
                        in: scriptImport.in,
                        out: scriptImport.out,
                    })
                })
            html.rewriteHrefs()
            await html.writeTo(watchDir)
            return html
        }),
    )

    const ctx = await esbuildDevContext(
        createGlobalDefinitions(),
        entryPoints,
        watchDir,
    )

    await ctx.watch()

    await ctx.serve({
        host: '127.0.0.1',
        port: ESBUILD_PORT,
        servedir: watchDir,
        cors: {
            origin: 'http://127.0.0.1:' + PORT,
        },
    })

    return { port: ESBUILD_PORT }
}
