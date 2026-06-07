import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    type BuildContext,
    type BuildFailure,
    type BuildOptions,
    type BuildResult,
    type Location,
    type Message,
    type Metafile,
    type PartialMessage,
    type Plugin,
    type PluginBuild,
    build,
    context,
} from 'esbuild'
import type { DefineDankGlobal } from './define.ts'
import type { DankDirectories } from './dirs.ts'
import {
    isEsbuildBuildFailure,
    printEsbuildBuildFailureMessages,
    printEsbuildWarnings,
} from './errors.ts'
import type {
    WebsiteRegistry,
    WorkerBuildRegistry,
    WorkerManifest,
} from './registry.ts'

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
              workersPlugin(wr, (build, wr) => r.mergeDevContext(build, wr)),
              errorsPlugin(r),
          ]
        : [workersPlugin(wr)]
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
            out: entryPoint.out.replace(/\.(tsx?|jsx?|css)$/, ''),
        }
    })
}

const WORKER_CTOR_REGEX =
    /new(?:\s|\r?\n)+(?<ctor>(?:Shared)?Worker)(?:\s|\r?\n)*\((?:\s|\r?\n)*(?<url>.*?)(?:\s|\r?\n)*(?<end>[\),])/g
const WORKER_URL_REGEX = /^('.*'|".*")$/

export function workersPlugin(
    wr: WorkerBuildRegistry,
    mergeDevCtx?: (build: Metafile, wr: WorkerBuildRegistry) => void,
): Plugin {
    return {
        name: '@eighty4/dank/esbuild/workers',
        setup(build: PluginBuild) {
            if (!build.initialOptions.metafile)
                throw TypeError('plugin requires metafile')

            build.onLoad({ filter: /\.(t|m?j)s$/ }, async args => {
                let contents = await readFile(args.path, 'utf8')
                let offset = 0
                let errors: Array<PartialMessage> | undefined = undefined
                let clientScript: string | undefined = undefined
                for (const workerCtorMatch of contents.matchAll(
                    WORKER_CTOR_REGEX,
                )) {
                    if (!WORKER_URL_REGEX.test(workerCtorMatch.groups!.url)) {
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
                    if (isIndexCommented(contents, workerCtorMatch.index)) {
                        continue
                    }
                    if (!clientScript) {
                        clientScript = wr.resolver.projectPathFromAbsolute(
                            args.path,
                        )
                    }
                    const originalCtorSrc =
                        workerCtorMatch.groups!.url.substring(
                            1,
                            workerCtorMatch.groups!.url.length - 1,
                        )
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
                        | 'Worker'
                        | 'SharedWorker'
                    const entrypoint: EsbuildEntrypoint = {
                        in: workerProjectPath,
                        out:
                            '.lib/' +
                            workerProjectPath
                                .replace(/\.(t|m?j)s$/, '.js')
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
                const loader = args.path.endsWith('ts') ? 'ts' : 'js'
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

function buildMessageLocation(
    file: string,
    contents: string,
    matchIndex: number,
    matchLength: number,
    suggestion: string = '',
): Location {
    const preamble = contents.substring(0, matchIndex)
    let lineStart = preamble.lastIndexOf('\n')
    lineStart = lineStart === -1 ? 0 : lineStart + 1
    const lineEnd = contents.indexOf('\n', lineStart)
    return {
        namespace: 'file',
        suggestion,
        file,
        lineText: contents.substring(
            lineStart,
            lineEnd === -1 ? contents.length : lineEnd,
        ),
        line: preamble.match(/\n/g)?.length || 1,
        column: preamble.length - lineStart,
        length: matchLength,
    }
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

// added to `esbuild.context({plugins})` to enhance errors logged by `esbuild.Context.serve()`
function errorsPlugin(r: WebsiteRegistry): Plugin {
    return {
        name: '@eighty4/dank/esbuild/errors',
        setup(build: PluginBuild) {
            if (!build.initialOptions.metafile)
                throw TypeError('plugin requires metafile')

            build.onEnd(async (result: BuildResult<{ metafile: true }>) => {
                if (result.errors.length) {
                    await enhanceEsbuildBuildFailure(r, result)
                    printEsbuildBuildFailureMessages(result)
                }
            })
        },
    }
}

async function enhanceEsbuildBuildFailure(
    r: WebsiteRegistry,
    e: Pick<BuildFailure, 'errors'>,
) {
    const unresolvedEntrypointPattern = new RegExp(
        /^Could not resolve "(?<p>.+?)"$/,
    )
    for (const m of e.errors) {
        const unresolvedEntrypointMatch = unresolvedEntrypointPattern.exec(
            m.text,
        )
        if (unresolvedEntrypointMatch) {
            const p = unresolvedEntrypointMatch.groups!.p
            const w = r.workers!.find(w => w.entrypoint.in === p)
            if (w) {
                await enhanceUnresolvedWorkerEntrypointMessage(r, m, p, w)
            }
        }
    }
}

async function enhanceUnresolvedWorkerEntrypointMessage(
    r: WebsiteRegistry,
    m: Message,
    unresolvePath: string,
    w: WorkerManifest,
) {
    const workerClient = w.clients[0]
    m.text = `Could not find ${workerClient.ctor} entrypoint "${unresolvePath}"`
    const source = await readFile(
        join(r.config.dirs.projectRootAbs, workerClient.script),
        'utf8',
    )
    const workerUrl = RegExp.escape(workerClient.originalCtorSrc)
    const sourcePattern = new RegExp(
        `new(?:\\s|\\r?\\n)+${workerClient.ctor}(?:\\s|\\r?\\n)*\\((?:\\s|\\r?\\n)*(?<url>('${workerUrl}'|"${workerUrl}"))(?:\\s|\\r?\\n)*[\\),]`,
    )
    const sourceMatch = sourcePattern.exec(source)
    if (sourceMatch) {
        const location = buildMessageLocation(
            workerClient.script,
            source,
            sourceMatch.index + sourceMatch[0].indexOf(sourceMatch.groups!.url),
            sourceMatch.groups!.url.length,
        )
        m.notes = [
            {
                text: `The ${workerClient.ctor} entrypoint was found in "${workerClient.script}":`,
                location,
            },
        ]
    }
}
