import { mkdir, rm } from 'node:fs/promises'
import { join as fsJoin } from 'node:path'
import type { BuildOptions } from 'esbuild'
import { performBuild, webpages, workers } from './build.ts'
import { esbuildDevContext } from './esbuild.ts'
import { isPreviewBuild, isProductionBuild } from './flags.ts'
import { HtmlEntrypoint } from './html.ts'
import {
    createEsbuildFilesFetcher,
    createFrontendFilesFetcher,
    createWebServer,
    type FrontendFetcher,
} from './http.ts'
import { copyAssets } from './public.ts'

if (process.argv.some(arg => arg === '-h' || arg === '--help')) {
    console.log(
        'node ./dev/serve.ts [--minify] [--preview] [--production] [--tsc]',
    )
    console.log('\nOPTIONS:')
    console.log('  --preview      pre-bundling with ServiceWorker')
    console.log()
    console.log(
        'all `pnpm build -h` options apply to `pnpm dev --preview` builds',
    )
    process.exit(0)
}

if (isProductionBuild() && !isPreviewBuild()) {
    console.error('dev/serve.ts --production requires --preview to be set')
    process.exit(1)
}

// alternate port for --preview bc of service worker
const PORT = isPreviewBuild() ? 4000 : 3000

// port for esbuild.serve
const ESBUILD_PORT = 2999

if (
    !process.env.GH_APP_ID ||
    !process.env.GH_CLIENT_ID ||
    !process.env.GH_CLIENT_SECRET
) {
    throw new Error('must set GH_APP_ID, GH_CLIENT_ID and GH_CLIENT_SECRET')
}

await rm('build', { force: true, recursive: true })

async function startEsbuildWatch(): Promise<{ port: number }> {
    const watchDir = fsJoin('build', 'watch')
    await mkdir(watchDir, { recursive: true })
    await copyAssets(watchDir)

    const entryPointUrls: Set<string> = new Set()
    const entryPoints: BuildOptions['entryPoints'] = []

    Object.entries(workers).map(([srcPath, url]) => {
        entryPoints.push({
            in: srcPath,
            out: url.substring(1, url.indexOf('.js')),
        })
    })

    const devWebpages = {
        ...webpages,
        ['/_components']: './_dev/components/Components.html',
        ['/_data']: './_dev/data/Data.html',
    }

    await Promise.all(
        Object.entries(devWebpages).map(async ([url, srcPath]) => {
            const html = await HtmlEntrypoint.readFrom(
                url,
                fsJoin('pages', srcPath),
            )
            await html.injectPartials()
            if (url !== '/') {
                await mkdir(fsJoin(watchDir, url), { recursive: true })
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

    const ctx = await esbuildDevContext(entryPoints, watchDir)

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

let frontend: FrontendFetcher
if (isPreviewBuild()) {
    const { dir, files } = await performBuild()
    frontend = createFrontendFilesFetcher(dir, files)
} else {
    const { port } = await startEsbuildWatch()
    frontend = createEsbuildFilesFetcher(port)
}

process.env.WEBAPP_ADDRESS = `http://127.0.0.1:${PORT}`

createWebServer(frontend).listen(PORT)

console.log(`sidelines.dev is running at http://127.0.0.1:${PORT}`)
