import esbuild, {
    type BuildContext,
    type BuildOptions,
    type BuildResult,
    type Message,
    type Metafile,
} from 'esbuild'
import type { DefineDankGlobal } from './define.ts'
import { willMinify } from './flags.ts'

const jsBuildOptions: BuildOptions & { metafile: true; write: true } = {
    bundle: true,
    metafile: true,
    minify: willMinify(),
    platform: 'browser',
    splitting: false,
    treeShaking: true,
    write: true,
}

const webpageBuildOptions: BuildOptions & { metafile: true; write: true } = {
    assetNames: 'assets/[name]-[hash]',
    format: 'esm',
    ...jsBuildOptions,
}

export async function esbuildDevContext(
    define: DefineDankGlobal,
    entryPoints: Array<{ in: string; out: string }>,
    outdir: string,
): Promise<BuildContext> {
    return await esbuild.context({
        define,
        entryNames: '[dir]/[name]',
        entryPoints: removeEntryPointOutExt(entryPoints),
        outdir,
        ...webpageBuildOptions,
    })
}

export async function esbuildWebpages(
    define: DefineDankGlobal,
    entryPoints: Array<{ in: string; out: string }>,
    outdir: string,
): Promise<Metafile> {
    const buildResult = await esbuild.build({
        define,
        entryNames: '[dir]/[name]-[hash]',
        entryPoints: removeEntryPointOutExt(entryPoints),
        outdir,
        ...webpageBuildOptions,
    })
    esbuildResultChecks(buildResult)
    return buildResult.metafile
}

// esbuild will append the .js or .css to output filenames
// keeping extension on entryPoints data for consistency
// and removing and mapping entryPoints to pass to esbuild
function removeEntryPointOutExt(
    entryPoints: Array<{ in: string; out: string }>,
) {
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
