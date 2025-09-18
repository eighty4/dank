import esbuild, {
    type BuildContext,
    type BuildOptions,
    type BuildResult,
    type Message,
    type Metafile,
} from 'esbuild'
import {
    defineSidelinesForEsbuildWatch,
    type DefineSidelinesGlobal,
} from './define.ts'
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
    assetNames: 'lib/assets/[name]-[hash]',
    // chunkNames: 'lib/sidelines/[name]-[hash]',
    external: ['monaco-editor'], //, 'react', 'react-dom'],
    format: 'esm',
    // loader: {
    //     '.ttf': 'file',
    // },
    ...jsBuildOptions,
}

const workerBuildOptions: BuildOptions & { metafile: true; write: true } = {
    format: 'iife',
    ...jsBuildOptions,
}

export async function esbuildDevContext(
    entryPoints: BuildOptions['entryPoints'],
    outdir: string,
): Promise<BuildContext> {
    return await esbuild.context({
        define: defineSidelinesForEsbuildWatch(),
        entryNames: '[dir]/[name]',
        entryPoints,
        outdir,
        ...webpageBuildOptions,
    })
}

export async function esbuildWebpages(
    define: DefineSidelinesGlobal,
    entryPoints: Array<{ in: string; out: string }>,
    outdir: string,
): Promise<Metafile> {
    const buildResult = await esbuild.build({
        define,
        entryNames: '[dir]/[name]-[hash]',
        entryPoints,
        outdir,
        ...webpageBuildOptions,
    })
    esbuildResultChecks(buildResult)
    return buildResult.metafile
}

export async function esbuildWorkers(
    entryPoints: Array<string>,
    entryNames: string,
    outdir: string,
): Promise<Metafile> {
    const buildResult = await esbuild.build({
        entryPoints,
        entryNames,
        outdir,
        ...workerBuildOptions,
    })
    esbuildResultChecks(buildResult)
    return buildResult.metafile
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
