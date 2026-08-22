import { readFile } from 'node:fs/promises'
import { extname, sep } from 'node:path'
import type {
    BuildResult,
    Metafile,
    PartialMessage,
    Plugin,
    PluginBuild,
} from 'esbuild'
import type { DankDirectories } from './dirs.ts'
import type { WorkerBuildRegistry } from './registry.ts'
import { parseWorkerCtors } from './web_workers.ts'

const EXT_JS_TS = /\.(tsx?|jsx?|mjs|mts)$/

function inNodeModulesPattern(dirs: DankDirectories): RegExp {
    return new RegExp(
        '^' +
            RegExp.escape(
                `${dirs.projectRootAbs}${sep}${'node_modules'}${sep}`,
            ),
    )
}

export type WorkersPluginInit = {
    mergeDevCtx?: (build: Metafile, wr: WorkerBuildRegistry) => void
    prependDevBootstrap?: () => boolean
}

// this is the only use case for loading and modifying sources
// if another esbuild plugin needs to modify sources on load
// a dank plugin will need to define an api for inverting
// loading and modifying sources for DANK features
export function createWorkersPlugin(
    wr: WorkerBuildRegistry,
    init?: WorkersPluginInit,
): Plugin {
    const IN_NODE_MODULES = inNodeModulesPattern(wr.dirs)
    const mergeDevCtx = init?.mergeDevCtx
    return {
        name: '@eighty4/dank/esbuild/workers',
        setup(build: PluginBuild) {
            if (!build.initialOptions.metafile)
                throw TypeError('plugin requires metafile')

            build.onLoad({ filter: EXT_JS_TS }, async args => {
                if (IN_NODE_MODULES.test(args.path)) {
                    return null
                }
                let contents = await readFile(args.path, 'utf8')
                let errors: Array<PartialMessage> | undefined = undefined

                const workerParse = parseWorkerCtors(
                    args.path,
                    contents,
                    wr.resolver,
                )
                if (workerParse.errors?.length) {
                    errors = workerParse.errors
                }
                if (workerParse.workers.length) {
                    contents = workerParse.result
                    for (const w of workerParse.workers) {
                        wr.addWorker(w)
                    }
                }

                const loader = loaderFromExt(extname(args.path))
                return { contents, errors, loader }
            })

            // only use build.onEnd when building with `esbuild.context` because
            // error reporting and stack traces are moot with esbuild's js/go native bridge and EventEmitter
            // events triggered from merging build state get processed within that bermuda triangle
            if (mergeDevCtx) {
                build.onEnd((result: BuildResult<{ metafile: true }>) => {
                    if (!result.errors.length && result.metafile) {
                        mergeDevCtx(result.metafile, wr)
                    }
                })
            }
        },
    }
}

function loaderFromExt(ext: string): 'ts' | 'tsx' | 'jsx' | 'js' {
    switch (ext) {
        case '.ts':
        case '.mts':
            return 'ts'
        case '.tsx':
            return 'tsx'
        case '.js':
        case '.mjs':
            return 'js'
        case '.jsx':
            return 'jsx'
        default:
            throw TypeError()
    }
}
