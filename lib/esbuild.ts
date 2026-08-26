import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
    type BuildContext,
    type BuildOptions,
    type Metafile,
    type OutputFile,
    build,
    context,
} from 'esbuild'
import type { DefineDankGlobal } from './define.ts'
import type { DankDirectories } from './dirs.ts'
import {
    EsbuildError,
    isEsbuildBuildFailure,
    printEsbuildWarnings,
} from './errors.ts'
import {
    createErrorPlugin,
    enhanceEsbuildBuildFailure,
} from './esbuild_error_plugin.ts'
import { createWorkersPlugin } from './esbuild_worker_plugin.ts'
import type {
    WebsiteRegistry,
    WorkerBuildRegistry,
    WorkerType,
} from './registry.ts'
import { verifyWorkerScopes } from './web_workers.ts'

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
        outdir: r.dirs.buildDist,
        ...commonBuildOptions(r),
        minify: false,
        plugins: esbuildPlugins(r, wr, true),
        splitting: false,
        write: false,
    })
}

export async function esbuildWebsite(
    r: WebsiteRegistry,
    define: DefineDankGlobal,
): Promise<void> {
    while (true) {
        const moduleWorkers = r.workerEntryPoints('module')
        const entrypoints = moduleWorkers?.length
            ? [...r.webpageEntryPoints, ...moduleWorkers]
            : r.webpageEntryPoints
        const wr = r.workerRegistry()
        const { warnings, metafile, outputFiles } = await build({
            define,
            entryNames: '[dir]/[name]-[hash]',
            entryPoints: mapEntryPointPaths(entrypoints),
            outdir: r.dirs.buildDist,
            ...commonBuildOptions(r),
            plugins: esbuildPlugins(r, wr),
        })
        let updatedWorkerTypes = r.mergeWorkerRegistry(metafile, wr)
        if (updatedWorkerTypes.has('classic')) {
            const classicBuildUpdatedWorkerTypes = await esbuildClassicWorkers(
                r,
                define,
            )
            if (classicBuildUpdatedWorkerTypes?.has('module')) {
                updatedWorkerTypes.add('module')
            }
        }
        if (updatedWorkerTypes.has('module')) {
            continue
        }
        if (warnings.length) {
            printEsbuildWarnings(warnings)
        }
        r.mergeBuiltBundles(metafile)
        const writingOutputs = Promise.all([
            writeDistOutputs(outputFiles!),
            writeMetafile(r.dirs, 'webpages.json', metafile),
        ])
        const workerWarnings = verifyWorkerScopes(r)
        if (workerWarnings?.length) {
            throw new EsbuildError(workerWarnings)
        }
        await writingOutputs
        return
    }
}

async function writeDistOutputs(outputFiles: Array<OutputFile>): Promise<void> {
    await Promise.all(
        outputFiles.map(async outputFile => {
            await mkdir(dirname(outputFile.path), { recursive: true })
            await writeFile(outputFile.path, outputFile.contents)
        }),
    )
}

async function esbuildClassicWorkers(
    r: WebsiteRegistry,
    define: DefineDankGlobal,
): Promise<Set<WorkerType> | null> {
    while (true) {
        const classicWorkers = r.workerEntryPoints('classic')
        if (!classicWorkers?.length) {
            return null
        }
        const wr = r.workerRegistry()
        let result
        try {
            result = await build({
                define,
                entryNames: '[dir]/[name]-[hash]',
                entryPoints: mapEntryPointPaths(classicWorkers),
                outdir: r.dirs.buildDist,
                ...commonBuildOptions(r),
                loader: undefined,
                format: 'iife',
                plugins: esbuildPlugins(r, wr),
                splitting: false,
                metafile: true,
                write: true,
            })
        } catch (e) {
            if (isEsbuildBuildFailure(e)) {
                await enhanceEsbuildBuildFailure(r, e)
            }
            throw e
        }
        const { warnings, metafile } = result
        const updatedWorkerTypes = r.mergeWorkerRegistry(metafile, wr)
        if (updatedWorkerTypes?.has('classic')) {
            continue
        }
        if (warnings.length) {
            printEsbuildWarnings(warnings)
        }
        await writeMetafile(r.dirs, 'workers.json', metafile)
        r.mergeBuiltBundles(metafile)
        return updatedWorkerTypes
    }
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
        absWorkingDir: r.dirs.projectRootAbs,
        assetNames: 'assets/[name]-[hash]',
        bundle: true,
        chunkNames: '.lib/c/[name]-[hash]',
        format: 'esm',
        loader: r.config.esbuild?.loaders || defaultLoaders(),
        metafile: true,
        minify: true,
        platform: 'browser',
        splitting: true,
        treeShaking: true,
        write: false,
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
