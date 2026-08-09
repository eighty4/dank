import { readFile } from 'node:fs/promises'
import { extname, sep } from 'node:path'
import type {
    BuildResult,
    Location,
    Metafile,
    PartialMessage,
    Plugin,
    PluginBuild,
} from 'esbuild'
import { buildMessageLocation } from './esbuild_messages.ts'
import type { DankDirectories } from './dirs.ts'
import type { EsbuildEntrypoint } from './esbuild.ts'
import type { WorkerBuildRegistry } from './registry.ts'

const EXT_JS_TS = /\.(tsx?|jsx?|mjs|mts)$/

const WORKER_CTOR_REGEX =
    /new(?:\s|\r?\n)+(?<ctor>(?:Shared)?Worker)(?:\s|\r?\n)*\((?:\s|\r?\n)*(?<url>.*?)(?:\s|\r?\n)*(?<end>[),])/g
const WORKER_URL_STRING_REGEX = /^('.*'|".*")$/
const WORKER_URL_REGEX = /^.*\.(ts|js|mts|mjs)$/

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
    // const prependWorkerBootstrap = init?.prependDevBootstrap ?? (() => false)
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
                let offset = 0
                let errors: Array<PartialMessage> | undefined = undefined
                let clientScript: string | undefined = undefined
                for (const workerCtorMatch of contents.matchAll(
                    WORKER_CTOR_REGEX,
                )) {
                    if (
                        !WORKER_URL_STRING_REGEX.test(
                            workerCtorMatch.groups!.url,
                        )
                    ) {
                        if (!errors) errors = []
                        errors.push(
                            invalidWorkerUrlCtorArg(
                                buildMessageLocation(
                                    args.path,
                                    contents,
                                    workerCtorMatch.index,
                                    workerCtorMatch[0].length,
                                ),
                                workerCtorMatch,
                            ),
                        )
                        continue
                    }
                    const originalCtorSrc =
                        workerCtorMatch.groups!.url.substring(
                            1,
                            workerCtorMatch.groups!.url.length - 1,
                        )
                    if (!WORKER_URL_REGEX.test(originalCtorSrc)) {
                        if (!errors) errors = []
                        errors.push(
                            invalidWorkerUrlExtension(
                                buildMessageLocation(
                                    args.path,
                                    contents,
                                    workerCtorMatch.index,
                                    workerCtorMatch[0].length,
                                ),
                                workerCtorMatch,
                            ),
                        )
                        continue
                    }
                    if (isIndexCommented(contents, workerCtorMatch.index)) {
                        continue
                    }
                    if (!clientScript) {
                        clientScript = wr.resolver.projectPathFromAbsolute(
                            args.path,
                        )
                    }
                    const workerProjectPath =
                        wr.resolver.resolvePagesRelativeHrefInProjectDir(
                            clientScript,
                            originalCtorSrc,
                        )
                    if (workerProjectPath === 'outofbounds') {
                        if (!errors) errors = []
                        errors.push(
                            outofboundsWorkerUrlCtorArg(
                                buildMessageLocation(
                                    args.path,
                                    contents,
                                    workerCtorMatch.index,
                                    workerCtorMatch[0].length,
                                ),
                                workerCtorMatch,
                            ),
                        )
                        continue
                    }
                    const ctor = workerCtorMatch.groups!.ctor as
                        'Worker' | 'SharedWorker'
                    const entrypoint: EsbuildEntrypoint = {
                        in: workerProjectPath,
                        out:
                            '.lib/' +
                            workerProjectPath
                                .replace(EXT_JS_TS, '.js')
                                .replaceAll('\\', '/'),
                    }
                    const placeholderCtorSrc: `/${string}` = `/${entrypoint.out}`
                    const workerCtorReplacement = `new ${ctor}('${placeholderCtorSrc}'${workerCtorMatch.groups!.end}`
                    contents =
                        contents.substring(0, workerCtorMatch.index + offset) +
                        workerCtorReplacement +
                        contents.substring(
                            workerCtorMatch.index +
                                workerCtorMatch[0].length +
                                offset,
                        )
                    offset +=
                        workerCtorReplacement.length - workerCtorMatch[0].length
                    wr.addWorker({
                        clientScript,
                        ctor,
                        entrypoint,
                        originalCtorSrc,
                        placeholderCtorSrc,
                    })
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

function isIndexCommented(contents: string, index: number) {
    const preamble = contents.substring(0, index)
    const lineIndex = preamble.lastIndexOf('\n') || 0
    const lineCommented = /\/\//.test(preamble.substring(lineIndex))
    if (lineCommented) {
        return true
    }
    const blockCommentIndex = preamble.lastIndexOf('/*')
    const blockCommented =
        blockCommentIndex !== -1 &&
        preamble.substring(blockCommentIndex).indexOf('*/') === -1
    return blockCommented
}

function outofboundsWorkerUrlCtorArg(
    location: Location,
    workerCtorMatch: RegExpExecArray,
): PartialMessage {
    return {
        id: 'worker-url-outofbounds',
        text: `The ${workerCtorMatch.groups!.ctor} constructor URL arg \`${workerCtorMatch.groups!.url}\` cannot resolve to a path outside of the project directory`,
        location,
    }
}

function invalidWorkerUrlCtorArg(
    location: Location,
    workerCtorMatch: RegExpExecArray,
): PartialMessage {
    return {
        id: 'worker-url-unresolvable',
        text: `The ${workerCtorMatch.groups!.ctor} constructor URL arg \`${workerCtorMatch.groups!.url}\` must be a relative module path`,
        location,
    }
}

function invalidWorkerUrlExtension(
    location: Location,
    workerCtorMatch: RegExpExecArray,
): PartialMessage {
    const url = workerCtorMatch.groups!.url.slice(1, -1)
    return {
        id: 'worker-url-unsupported-ext',
        text: `The ${workerCtorMatch.groups!.ctor} URL \`${url}\` needs a \`ts\` or \`js\` extension`,
        location: {
            ...location,
            column: location.column + workerCtorMatch[0].lastIndexOf('.'),
            length: url.length - url.lastIndexOf('.'),
        },
    }
}
