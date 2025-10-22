import esbuild, {
    type BuildContext,
    type BuildOptions,
    type BuildResult,
    type Message,
    type Metafile,
} from 'esbuild'
import type { EsbuildConfig } from './dank.ts'
import type { DefineDankGlobal } from './define.ts'
import type { DankBuild } from './flags.ts'

function jsBuildOptions(b: DankBuild, c?: EsbuildConfig): BuildOptions {
    return {
        loader: c?.loaders || defaultLoaders(),
        minify: b.minify,
        platform: 'browser',
        plugins: c?.plugins,
        splitting: false,
        treeShaking: true,
        format: 'esm',
    }
}

function webpageBuildOptions(
    b: DankBuild,
    c?: EsbuildConfig,
): BuildOptions & { metafile: true; write: true } {
    return {
        ...jsBuildOptions(b, c),
        bundle: true,
        metafile: true,
        write: true,
        assetNames: 'assets/[name]-[hash]',
    }
}

function defaultLoaders(): BuildOptions['loader'] {
    return {
        '.woff': 'file',
        '.woff2': 'file',
    }
}

export async function esbuildDevContext(
    b: DankBuild,
    define: DefineDankGlobal,
    entryPoints: Array<{ in: string; out: string }>,
    c?: EsbuildConfig,
): Promise<BuildContext> {
    return await esbuild.context({
        define,
        entryNames: '[dir]/[name]',
        entryPoints: mapEntryPointPaths(entryPoints),
        outdir: b.dirs.buildWatch,
        ...webpageBuildOptions(b, c),
        metafile: false,
        write: false,
    })
}

export async function esbuildWebpages(
    b: DankBuild,
    define: DefineDankGlobal,
    entryPoints: Array<{ in: string; out: string }>,
    c?: EsbuildConfig,
): Promise<Metafile> {
    const buildResult = await esbuild.build({
        define,
        entryNames: '[dir]/[name]-[hash]',
        entryPoints: mapEntryPointPaths(entryPoints),
        outdir: b.dirs.buildDist,
        ...webpageBuildOptions(b, c),
    })
    esbuildResultChecks(buildResult)
    return buildResult.metafile
}

// esbuild will append the .js or .css to output filenames
// keeping extension on entryPoints data for consistency
function mapEntryPointPaths(entryPoints: Array<{ in: string; out: string }>) {
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
