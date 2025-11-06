import { readFile } from 'node:fs/promises'
import esbuild, {
    type BuildContext,
    type BuildOptions,
    type BuildResult,
    type Message,
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
    const result = await esbuild.build({
        define,
        entryNames: '[dir]/[name]-[hash]',
        entryPoints: mapEntryPointPaths(entryPoints),
        outdir: b.dirs.buildDist,
        ...commonBuildOptions(b, r, c),
    })
    esbuildResultChecks(result)
}

export async function esbuildWorkers(
    b: DankBuild,
    r: WebsiteRegistry,
    define: DefineDankGlobal,
    entryPoints: Array<EntryPoint>,
    c?: EsbuildConfig,
): Promise<void> {
    const result = await esbuild.build({
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
    esbuildResultChecks(result)
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

function esbuildResultChecks(buildResult: BuildResult) {
    if (buildResult.errors.length) {
        buildResult.errors.forEach(msg => esbuildPrintMessage(msg, 'warning'))
        process.exit(1)
    }
    if (buildResult.warnings.length) {
        buildResult.warnings.forEach(msg => esbuildPrintMessage(msg, 'warning'))
    }
}

function esbuildPrintMessage(msg: Message, category: 'error' | 'warning') {
    const location = msg.location
        ? ` (${msg.location.file}L${msg.location.line}:${msg.location.column})`
        : ''
    console.error(`esbuild ${category}${location}:`, msg.text)
    msg.notes.forEach(note => {
        console.error('  ', note.text)
        if (note.location) console.error('   ', note.location)
    })
}

const WORKER_CTOR_REGEX =
    /new(?:\s|\r?\n)+Worker(?:\s|\r?\n)*\((?:\s|\r?\n)*(?<url>.*)(?:\s|\r?\n)*\)/g
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
                    const workerUrlString = workerCtorMatch.groups!.url
                    if (WORKER_URL_REGEX.test(workerUrlString)) {
                        const preamble = contents.substring(
                            0,
                            workerCtorMatch.index,
                        )
                        const lineIndex = preamble.lastIndexOf('\n') || 0
                        const lineCommented = /\/\//.test(
                            preamble.substring(lineIndex),
                        )
                        if (lineCommented) continue
                        const blockCommentIndex = preamble.lastIndexOf('/*')
                        const blockCommented =
                            blockCommentIndex !== -1 &&
                            preamble
                                .substring(blockCommentIndex)
                                .indexOf('*/') === -1
                        if (blockCommented) continue
                        const clientScript = args.path
                            .replace(absWorkingDir, '')
                            .substring(1)
                        const workerUrl = workerUrlString.substring(
                            1,
                            workerUrlString.length - 1,
                        )
                        // todo out of bounds error on path resolve
                        const workerEntryPoint = r.resolve(
                            clientScript,
                            workerUrl,
                        )
                        const workerUrlPlaceholder = workerEntryPoint
                            .replace(/^pages/, '')
                            .replace(/\.(t|m?j)s$/, '.js')
                        const workerCtorReplacement = `new Worker('${workerUrlPlaceholder}')`
                        contents =
                            contents.substring(
                                0,
                                workerCtorMatch.index + offset,
                            ) +
                            workerCtorReplacement +
                            contents.substring(
                                workerCtorMatch.index +
                                    workerCtorMatch[0].length +
                                    offset,
                            )
                        offset +=
                            workerCtorReplacement.length -
                            workerCtorMatch[0].length
                        r.addWorker({
                            clientScript,
                            workerEntryPoint,
                            workerUrl,
                            workerUrlPlaceholder,
                        })
                    } else {
                        if (!errors) errors = []
                        const preamble = contents.substring(
                            0,
                            workerCtorMatch.index,
                        )
                        const line = preamble.match(/\n/g)?.length || 0
                        const lineIndex = preamble.lastIndexOf('\n') || 0
                        const column = preamble.length - lineIndex
                        const lineText = contents.substring(
                            lineIndex,
                            contents.indexOf('\n', lineIndex) ||
                                contents.length,
                        )
                        errors.push({
                            id: 'worker-url-unresolvable',
                            location: {
                                lineText,
                                line,
                                column,
                                file: args.path,
                                length: workerCtorMatch[0].length,
                            },
                        })
                    }
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
