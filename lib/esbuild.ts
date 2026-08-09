import { writeFile } from 'node:fs/promises'
import {
    type BuildContext,
    type BuildOptions,
    type Metafile,
    build,
    context,
} from 'esbuild'
import type { DefineDankGlobal } from './define.ts'
import type { DankDirectories } from './dirs.ts'
import { isEsbuildBuildFailure, printEsbuildWarnings } from './errors.ts'
import {
    createErrorPlugin,
    enhanceEsbuildBuildFailure,
} from './esbuild_error_plugin.ts'
import { createWorkersPlugin } from './esbuild_worker_plugin.ts'
import type { WebsiteRegistry, WorkerBuildRegistry } from './registry.ts'

const EXT_CSS_JS_TS = /\.(tsx?|jsx?|css|mts|mjs)$/

export type EsbuildEntrypoint = { in: string; out: string }

export async function esbuildDevContext(
    r: WebsiteRegistry,
    define: DefineDankGlobal,
    entryPoints: Array<EsbuildEntrypoint>,
): Promise<BuildContext> {
    const wr = r.workerRegistry()
    return await context({
        define,
        entryNames: '[dir]/[name]',
        entryPoints: mapEntryPointPaths(entryPoints),
        outdir: r.config.dirs.buildDist,
        ...commonBuildOptions(r),
        minify: false,
        plugins: esbuildPlugins(r, wr, true),
        splitting: false,
        write: false,
    })
}

export async function esbuildWebpages(
    r: WebsiteRegistry,
    define: DefineDankGlobal,
    entryPoints: Array<EsbuildEntrypoint>,
): Promise<void> {
    const wr = r.workerRegistry()
    const { warnings, metafile } = await build({
        define,
        entryNames: '[dir]/[name]-[hash]',
        entryPoints: mapEntryPointPaths(entryPoints),
        outdir: r.config.dirs.buildDist,
        ...commonBuildOptions(r),
        plugins: esbuildPlugins(r, wr),
    })
    if (warnings.length) {
        printEsbuildWarnings(warnings)
    }
    await writeMetafile(r.config.dirs, 'webpages.json', metafile)
    r.mergeBuiltBundles(metafile)
    r.mergeWorkerRegistry(metafile, wr)
}

export async function esbuildWorkers(
    r: WebsiteRegistry,
    define: DefineDankGlobal,
): Promise<boolean> {
    if (!r.hasWebWorkers()) {
        return false
    }
    const wr = r.workerRegistry()
    let result
    try {
        result = await build({
            define,
            entryNames: '[dir]/[name]-[hash]',
            entryPoints: mapEntryPointPaths(r.workerEntryPoints!),
            outdir: r.config.dirs.buildDist,
            ...commonBuildOptions(r),
            plugins: esbuildPlugins(r, wr),
            splitting: false,
            metafile: true,
            write: true,
            assetNames: 'assets/[name]-[hash]',
        })
    } catch (e) {
        if (isEsbuildBuildFailure(e)) {
            await enhanceEsbuildBuildFailure(r, e)
        }
        throw e
    }
    const { warnings, metafile } = result
    if (warnings.length) {
        printEsbuildWarnings(warnings)
    }
    await writeMetafile(r.config.dirs, 'workers.json', metafile)
    r.mergeBuiltBundles(metafile)
    return true
}

async function writeMetafile(
    dirs: DankDirectories,
    file: 'webpages.json' | 'workers.json',
    metafile: Metafile,
): Promise<void> {
    await writeFile(dirs.metafiles(file), JSON.stringify(metafile, null, 4))
}

function commonBuildOptions(
    r: WebsiteRegistry,
): BuildOptions & { metafile: true } {
    return {
        logLevel: 'silent',
        absWorkingDir: r.config.dirs.projectRootAbs,
        assetNames: 'assets/[name]-[hash]',
        bundle: true,
        format: 'esm',
        loader: r.config.esbuild?.loaders || defaultLoaders(),
        metafile: true,
        minify: true,
        platform: 'browser',
        splitting: true,
        treeShaking: true,
        write: true,
    }
}

function defaultLoaders(): BuildOptions['loader'] {
    return {
        '.woff': 'file',
        '.woff2': 'file',
    }
}

// `dank serve` uses `devCtx` flag to merge result on each build
// `dank build` merges after `esbuild.build` completes without error
function esbuildPlugins(
    r: WebsiteRegistry,
    wr: WorkerBuildRegistry,
    devCtx: boolean = false,
): NonNullable<BuildOptions['plugins']> {
    const p = devCtx
        ? [
              createWorkersPlugin(wr, {
                  mergeDevCtx: (build, wr) => r.mergeDevContext(build, wr),
              }),
              createErrorPlugin(r),
          ]
        : [createWorkersPlugin(wr)]
    if (r.config.esbuild?.plugins?.length) {
        p.push(...r.config.esbuild.plugins)
    }
    return p
}

// esbuild will append the .js or .css to output filenames
// keeping extension on entryPoints data for consistency
// and only trimming when creating esbuild opts
function mapEntryPointPaths(entryPoints: Array<EsbuildEntrypoint>) {
    return entryPoints.map(entryPoint => {
        return {
            in: entryPoint.in,
            out: entryPoint.out.replace(EXT_CSS_JS_TS, ''),
        }
    })
}
