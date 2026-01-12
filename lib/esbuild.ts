import { readFile } from 'node:fs/promises'
import esbuild, {
    type BuildContext,
    type BuildOptions,
    type BuildResult,
    type Location,
    type OnLoadArgs,
    type PartialMessage,
    type Plugin,
    type PluginBuild,
} from 'esbuild'
import type { EsbuildConfig } from './dank.ts'
import type { DefineDankGlobal } from './define.ts'
import type { DankBuild } from './flags.ts'
import type { BuildRegistry, WebsiteRegistry } from './metadata.ts'

export type EntryPoint = { in: string; out: string }

export async function esbuildDevContext(
    b: DankBuild,
    r: WebsiteRegistry,
    define: DefineDankGlobal,
    entryPoints: Array<EntryPoint>,
    c?: EsbuildConfig,
): Promise<BuildContext> {
    return await esbuild.context({
        define,
        entryNames: '[dir]/[name]',
        entryPoints: mapEntryPointPaths(entryPoints),
        outdir: b.dirs.buildWatch,
        ...commonBuildOptions(b, r, c),
        splitting: false,
        write: false,
    })
}

export async function esbuildWebpages(
    b: DankBuild,
    r: WebsiteRegistry,
    define: DefineDankGlobal,
    entryPoints: Array<EntryPoint>,
    c?: EsbuildConfig,
): Promise<void> {
    try {
        await esbuild.build({
            define,
            entryNames: '[dir]/[name]-[hash]',
            entryPoints: mapEntryPointPaths(entryPoints),
            outdir: b.dirs.buildDist,
            ...commonBuildOptions(b, r, c),
        })
    } catch (ignore) {
        process.exit(1)
    }
}

export async function esbuildWorkers(
    b: DankBuild,
    r: WebsiteRegistry,
    define: DefineDankGlobal,
    entryPoints: Array<EntryPoint>,
    c?: EsbuildConfig,
): Promise<void> {
    try {
        await esbuild.build({
            define,
            entryNames: '[dir]/[name]-[hash]',
            entryPoints: mapEntryPointPaths(entryPoints),
            outdir: b.dirs.buildDist,
            ...commonBuildOptions(b, r, c),
            splitting: false,
            metafile: true,
            write: true,
            assetNames: 'assets/[name]-[hash]',
        })
    } catch (ignore) {
        process.exit(1)
    }
}

function commonBuildOptions(
    b: DankBuild,
    r: WebsiteRegistry,
    c?: EsbuildConfig,
): BuildOptions {
    const p = workersPlugin(r.buildRegistry())
    return {
        absWorkingDir: b.dirs.projectRootAbs,
        assetNames: 'assets/[name]-[hash]',
        bundle: true,
        format: 'esm',
        loader: c?.loaders || defaultLoaders(),
        metafile: true,
        minify: b.minify,
        platform: 'browser',
        plugins: c?.plugins?.length ? [p, ...c.plugins] : [p],
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

// esbuild will append the .js or .css to output filenames
// keeping extension on entryPoints data for consistency
// and only trimming when creating esbuild opts
function mapEntryPointPaths(entryPoints: Array<EntryPoint>) {
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

export function workersPlugin(r: BuildRegistry): Plugin {
    return {
        name: '@eighty4/dank/esbuild/workers',
        setup(build: PluginBuild) {
            if (!build.initialOptions.absWorkingDir)
                throw TypeError('plugin requires absWorkingDir')
            if (!build.initialOptions.metafile)
                throw TypeError('plugin requires metafile')
            const { absWorkingDir } = build.initialOptions

            build.onLoad({ filter: /\.(t|m?j)s$/ }, async args => {
                let contents = await readFile(args.path, 'utf8')
                let offset = 0
                let errors: Array<PartialMessage> | undefined = undefined
                for (const workerCtorMatch of contents.matchAll(
                    WORKER_CTOR_REGEX,
                )) {
                    if (!WORKER_URL_REGEX.test(workerCtorMatch.groups!.url)) {
                        if (!errors) errors = []
                        errors.push(
                            invalidWorkerUrlCtorArg(
                                locationFromMatch(
                                    args,
                                    contents,
                                    workerCtorMatch,
                                ),
                                workerCtorMatch,
                            ),
                        )
                        continue
                    }
                    if (isIndexCommented(contents, workerCtorMatch.index)) {
                        continue
                    }
                    const clientScript = args.path
                        .replace(absWorkingDir, '')
                        .substring(1)
                    const workerUrl = workerCtorMatch.groups!.url.substring(
                        1,
                        workerCtorMatch.groups!.url.length - 1,
                    )
                    const workerEntryPoint = r.resolver.resolveHrefInPagesDir(
                        clientScript,
                        workerUrl,
                    )
                    if (workerEntryPoint === 'outofbounds') {
                        if (!errors) errors = []
                        errors.push(
                            outofboundsWorkerUrlCtorArg(
                                locationFromMatch(
                                    args,
                                    contents,
                                    workerCtorMatch,
                                ),
                                workerCtorMatch,
                            ),
                        )
                        continue
                    }
                    const workerUrlPlaceholder = workerEntryPoint
                        .replace(/^pages/, '')
                        .replace(/\.(t|m?j)s$/, '.js')
                    const workerCtorReplacement = `new ${workerCtorMatch.groups!.ctor}('${workerUrlPlaceholder}'${workerCtorMatch.groups!.end}`
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
                    r.addWorker({
                        clientScript,
                        workerEntryPoint,
                        workerUrl,
                        workerUrlPlaceholder,
                    })
                }
                const loader = args.path.endsWith('ts') ? 'ts' : 'js'
                return { contents, errors, loader }
            })

            build.onEnd((result: BuildResult<{ metafile: true }>) => {
                if (result.metafile) {
                    r.completeBuild(result)
                }
            })
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

function locationFromMatch(
    args: OnLoadArgs,
    contents: string,
    match: RegExpExecArray,
): Partial<Location> {
    const preamble = contents.substring(0, match.index)
    const line = preamble.match(/\n/g)?.length || 0
    let lineIndex = preamble.lastIndexOf('\n')
    lineIndex = lineIndex === -1 ? 0 : lineIndex + 1
    const column = preamble.length - lineIndex
    const lineText = contents.substring(
        lineIndex,
        contents.indexOf('\n', lineIndex) || contents.length,
    )
    return {
        lineText,
        line,
        column,
        file: args.path,
        length: match[0].length,
    }
}

function outofboundsWorkerUrlCtorArg(
    location: Partial<Location>,
    workerCtorMatch: RegExpExecArray,
): PartialMessage {
    return {
        id: 'worker-url-outofbounds',
        text: `The ${workerCtorMatch.groups!.ctor} constructor URL arg \`${workerCtorMatch.groups!.url}\` cannot resolve to a path outside of the pages directory`,
        location,
    }
}

function invalidWorkerUrlCtorArg(
    location: Partial<Location>,
    workerCtorMatch: RegExpExecArray,
): PartialMessage {
    return {
        id: 'worker-url-unresolvable',
        text: `The ${workerCtorMatch.groups!.ctor} constructor URL arg \`${workerCtorMatch.groups!.url}\` must be a relative module path`,
        location,
    }
}
