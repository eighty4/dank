import { exec } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import {
    defineSidelinesFromWorkerUrls,
    type DefineSidelinesGlobal,
    monacoVersion,
} from './define.ts'
import { esbuildWebpages, esbuildWorkers } from './esbuild.ts'
import { isProductionBuild, willMinify, willTsc } from './flags.ts'
import { HtmlEntrypoint } from './html.ts'
import { copyAssets } from './public.ts'

// fyi if invoked directly by shell as executable it would be argv[0]
const isMain = process.argv[1].endsWith(import.meta.filename)

if (isMain && process.argv.some(arg => arg === '-h' || arg === '--help')) {
    console.log('node ./dev/build.ts [--minify] [--production] [--tsc]')
    console.log('\nOPTIONS:')
    console.log('  --minify       minify sources')
    console.log('  --production   build for production release')
    console.log('  --tsc          compile libs/* ts to js')
    process.exit(0)
}

const buildTag = await createBuildTag()
const buildDir = join('build', 'dist')

// maps url to entrypoint src
export const webpages: Record<string, string> = {
    '/': './home/Home.html',
    '/configure': './configure/Configure.html',
    '/gameplan': './gameplan/Gameplan.html',
    '/project': './project/Project.html',
    '/notes': './project/notes/Notes.html',

    // watches
    '/reading': './watching/reading/Reading.html',
    '/watches': './watching/watches/Watches.html',
}

// worker urls are namespaced in /lib/monaco/workers or /lib/sidelines/workers
// monaco urls are versioned by npm package version
// sidelines urls are versioned by build hash
//
// maps entrypoint src to url
export const workers: Record<string, string> = {
    // sync loop and scheduling
    './workers/syncing/syncPackages.ts':
        '/lib/sidelines/workers/syncPackages.js',
    './workers/syncing/syncRefs.ts': '/lib/sidelines/workers/syncRefs.js',
    './workers/syncing/syncWatches.ts': '/lib/sidelines/workers/syncWatches.js',

    // data apis
    './workers/userData.ts': '/lib/sidelines/workers/userData.js',
    './workers/watches.ts': '/lib/sidelines/workers/watches.js',

    // gh webhook <-> websocket or sse streaming
    // './workers/eventStream.ts': '/lib/sidelines/workers/eventStream.js',

    // gh action workflow validation
    './workers/ghActions.ts': '/lib/sidelines/workers/ghActions.js',

    // monaco
    './node_modules/monaco-editor/esm/vs/editor/editor.worker.js':
        '/lib/monaco/workers/main.js',
    './node_modules/monaco-editor/esm/vs/language/css/css.worker.js':
        '/lib/monaco/workers/css.js',
    './node_modules/monaco-editor/esm/vs/language/html/html.worker.js':
        '/lib/monaco/workers/html.js',
    './node_modules/monaco-editor/esm/vs/language/json/json.worker.js':
        '/lib/monaco/workers/json.js',
    './node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js':
        '/lib/monaco/workers/ts.js',
}

if (isMain) {
    await performBuild()
}

async function createBuildTag(): Promise<string> {
    const now = new Date()
    const ms =
        now.getUTCMilliseconds() +
        now.getUTCSeconds() * 1000 +
        now.getUTCMinutes() * 1000 * 60 +
        now.getUTCHours() * 1000 * 60 * 60
    const date = now.toISOString().substring(0, 10)
    const time = String(ms).padStart(8, '0')
    const when = `${date}-${time}`
    if (isProductionBuild()) {
        const gitHash = await new Promise((res, rej) =>
            exec('git rev-parse --short HEAD', (err, stdout) => {
                if (err) rej(err)
                res(stdout.trim())
            }),
        )
        return `${when}-${gitHash}`
    } else {
        return when
    }
}

export async function performBuild(): Promise<{
    dir: string
    files: Set<string>
}> {
    console.log(
        willMinify()
            ? isProductionBuild()
                ? 'minified production'
                : 'minified'
            : 'unminified',
        'build',
        buildTag,
        'building in ./build/dist',
    )
    await rm('build', { recursive: true, force: true })
    if (willTsc()) {
        await tscBuild()
    }
    await mkdir(buildDir, { recursive: true })
    await mkdir(join('build', 'metafiles'), { recursive: true })
    const staticAssets = await copyAssets(join('build', 'dist'))
    const buildUrls: Array<string> = []
    const workerBuildUrls = await buildWorkers('sidelines')
    const definitions = defineSidelinesFromWorkerUrls(workerBuildUrls)
    await writeJsonToBuildDir('definitions.json', definitions)
    buildUrls.push(...(await buildWebpages(definitions)))
    buildUrls.push(...Object.values(workerBuildUrls))
    buildUrls.push(...Object.values(await buildWorkers('monaco')))
    buildUrls.push(
        await buildServiceWorker(
            new Set([...buildUrls, ...staticAssets.cached]),
        ),
    )
    buildUrls.push(...staticAssets.all)
    const result = new Set(buildUrls)
    await writeBuildManifest(result)
    validateBuildUrls(result)
    return {
        dir: buildDir,
        files: result,
    }
}

async function tscBuild(): Promise<void | never> {
    await new Promise<void>(res =>
        exec('pnpm exec tsc --build', err => {
            if (err) {
                console.error('failed tsc, run `pnpm exec tsc --build`')
                process.exit(1)
            } else {
                res()
            }
        }),
    )
}

async function buildWorkers(
    kind: 'monaco' | 'sidelines',
): Promise<Record<string, string>> {
    const versioning = kind === 'monaco' ? monacoVersion : '[hash]'
    const entryPoints: Array<string> = Object.keys(workers).filter(path =>
        workers[path].startsWith(`/lib/${kind}/workers/`),
    )
    const metafile = await esbuildWorkers(
        entryPoints,
        `[name]-${versioning}`,
        join(buildDir, 'lib', kind, 'workers'),
    )
    await writeMetafile(`workers.${kind}.json`, metafile)
    const workerBuildUrls: Record<string, string> = {}
    for (const [outputFile, { entryPoint }] of Object.entries(
        metafile.outputs,
    )) {
        const from =
            workers[
                entryPoint!.startsWith('node_modules')
                    ? Object.keys(workers).find(path =>
                          entryPoint!.endsWith(path.substring(2)),
                      )!
                    : `./${entryPoint}`
            ]
        const to = outputFile.substring(outputFile.indexOf('/lib/'))
        workerBuildUrls[from] = to
    }
    return workerBuildUrls
}

async function buildWebpages(
    define: DefineSidelinesGlobal,
): Promise<Array<string>> {
    const entryPointUrls: Set<string> = new Set()
    const entryPoints: Array<{ in: string; out: string }> = []
    const htmlEntrypoints: Array<HtmlEntrypoint> = await Promise.all(
        Object.entries(webpages).map(async ([urlPath, fsPath]) => {
            const html = await HtmlEntrypoint.readFrom(
                urlPath,
                join('pages', fsPath),
            )
            await html.injectPartials()
            if (urlPath !== '/') {
                await mkdir(join(buildDir, urlPath), { recursive: true })
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
            return html
        }),
    )
    const metafile = await esbuildWebpages(define, entryPoints, buildDir)
    await writeMetafile(`pages.json`, metafile)
    const mapInToOutHrefs: Record<string, string> = {}
    for (const [outputFile, { entryPoint }] of Object.entries(
        metafile.outputs,
    )) {
        mapInToOutHrefs[entryPoint!] = outputFile.substring(
            outputFile.indexOf('/lib/sidelines/pages'),
        )
    }
    await Promise.all(
        htmlEntrypoints.map(async html => {
            html.rewriteHrefs(mapInToOutHrefs)
            await html.writeTo(buildDir)
        }),
    )
    return [
        ...Object.keys(webpages),
        ...Object.keys(metafile.outputs).map(p =>
            p.substring(p.indexOf('/lib/sidelines/')),
        ),
    ]
}

async function buildServiceWorker(files: Set<string>): Promise<string> {
    await writeCacheManifest(files)
    const metafile = await esbuildWorkers(
        ['./workers/serviceWorker.ts'],
        'sidelines.sw',
        buildDir,
    )
    await writeMetafile(`sidelines.sw.json`, metafile)
    return '/sidelines.sw.js'
}

// safety check to catch conflicts with github style repo routes
function validateBuildUrls(files: Set<string>) {
    let e = false
    for (const f of files) {
        if (!f.startsWith('/')) {
            console.error(f, 'is not prefixed with /')
            e = true
        } else if (f.split('/').length === 3) {
            console.error(f, 'clashes with /owner/repo style repo routes')
            e = true
        }
    }
    if (e) process.exit(1)
}

async function writeMetafile(filename: `${string}.json`, json: any) {
    await writeJsonToBuildDir(
        join('metafiles', filename) as `${string}.json`,
        json,
    )
}

async function writeCacheManifest(files: Set<string>) {
    // calling tsc --build from this script when libs do not have lib_js built
    // causes dep on this project reference to fail tsc
    // dynamic import here removes the compile error in that scenario
    // ideally tsc --build to build libs should not typecheck dev scripts
    // but for now the same tsconfig.json is also used to typecheck ./dev
    const { paths: apiRoutes } = await import('@sidelines/server/routes')
    await writeJsonToBuildDir('cache.json', {
        apiRoutes,
        buildTag,
        files: Array.from(files).map(filenameToWebappPath),
    })
}

// drops index.html from path
function filenameToWebappPath(p: string): string {
    if (p === '/index.html') {
        return '/'
    } else if (p.endsWith('/index.html')) {
        return p.substring(0, p.length - '/index.html'.length) as `/${string}`
    } else {
        return p
    }
}

async function writeBuildManifest(files: Set<string>) {
    await writeJsonToBuildDir('manifest.json', {
        buildTag,
        files: Array.from(files).map(f =>
            extname(f).length
                ? f
                : f === '/'
                  ? '/index.html'
                  : f + '/index.html',
        ),
    })
}

async function writeJsonToBuildDir(filename: `${string}.json`, json: any) {
    await writeFile(join('./build', filename), JSON.stringify(json, null, 4))
}
