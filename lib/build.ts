import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBuildTag } from './build_tag.ts'
import type { DankConfig } from './dank.ts'
import { type DefineDankGlobal, createGlobalDefinitions } from './define.ts'
import { esbuildWebpages, esbuildWorkers, type EntryPoint } from './esbuild.ts'
import { resolveBuildFlags, type DankBuild } from './flags.ts'
import { HtmlEntrypoint } from './html.ts'
import { type WebsiteManifest, WebsiteRegistry } from './metadata.ts'
import { copyAssets } from './public.ts'

export async function buildWebsite(c: DankConfig): Promise<WebsiteManifest> {
    const build: DankBuild = resolveBuildFlags()
    const buildTag = await createBuildTag(build)
    console.log(
        build.minify
            ? build.production
                ? 'minified production'
                : 'minified'
            : 'unminified',
        'build',
        buildTag,
        'building in ./build/dist',
    )
    await rm(build.dirs.buildRoot, { recursive: true, force: true })
    await mkdir(build.dirs.buildDist, { recursive: true })
    for (const subdir of Object.keys(c.pages).filter(url => url !== '/')) {
        await mkdir(join(build.dirs.buildDist, subdir), { recursive: true })
    }
    await mkdir(join(build.dirs.buildRoot, 'metafiles'), { recursive: true })
    const registry = new WebsiteRegistry(build)
    registry.pageUrls = Object.keys(c.pages)
    registry.copiedAssets = await copyAssets(build)
    await buildWebpages(c, registry, build, createGlobalDefinitions(build))
    return await registry.writeManifest(buildTag)
}

// builds all webpage entrypoints in one esbuild.build context
// to support code splitting
// returns all built assets URLs and webpage URLs from DankConfig.pages
async function buildWebpages(
    c: DankConfig,
    registry: WebsiteRegistry,
    build: DankBuild,
    define: DefineDankGlobal,
) {
    // create HtmlEntrypoint for each webpage and collect awaitable esbuild entrypoints
    const loadingEntryPoints: Array<Promise<Array<EntryPoint>>> = []
    const htmlEntrypoints: Array<HtmlEntrypoint> = []
    for (const [urlPath, mapping] of Object.entries(c.pages)) {
        const fsPath = typeof mapping === 'string' ? mapping : mapping.webpage
        const html = new HtmlEntrypoint(
            build,
            registry.resolver,
            urlPath,
            fsPath,
        )
        loadingEntryPoints.push(new Promise(res => html.on('entrypoints', res)))
        htmlEntrypoints.push(html)
    }

    // collect esbuild entrypoints from every HtmlEntrypoint
    const uniqueEntryPoints: Set<string> = new Set()
    const buildEntryPoints: Array<EntryPoint> = []
    for (const pageEntryPoints of await Promise.all(loadingEntryPoints)) {
        for (const entryPoint of pageEntryPoints) {
            if (!uniqueEntryPoints.has(entryPoint.in)) {
                buildEntryPoints.push(entryPoint)
            }
        }
    }

    await esbuildWebpages(build, registry, define, buildEntryPoints, c.esbuild)

    // todo recursively build workers on building workers that create workers
    const workerEntryPoints = registry.workerEntryPoints()
    if (workerEntryPoints?.length) {
        await esbuildWorkers(
            build,
            registry,
            define,
            workerEntryPoints,
            c.esbuild,
        )
    }
    await rewriteWorkerUrls(build, registry)

    // write out html output with rewritten hrefs
    await Promise.all(
        htmlEntrypoints.map(async html => {
            await writeFile(
                join(build.dirs.buildDist, html.url, 'index.html'),
                html.output(registry),
            )
        }),
    )
}

export async function rewriteWorkerUrls(
    build: DankBuild,
    registry: WebsiteRegistry,
) {
    const workers = registry.workers()
    if (!workers) {
        return
    }
    const dependentBundlePaths = workers.map(w =>
        registry.mappedHref(w.dependentEntryPoint),
    )
    const bundleOutputs: Record<string, string> = {}

    // collect all js file contents concurrently
    const readingFiles = Promise.all(
        dependentBundlePaths.map(async p => {
            bundleOutputs[p] = await readFile(
                join(build.dirs.projectRootAbs, build.dirs.buildDist, p),
                'utf8',
            )
        }),
    )

    // build regex replacements during file reads
    const rewriteChains: Record<string, Array<(s: string) => string>> = {}
    for (const p of dependentBundlePaths) rewriteChains[p] = []
    for (const w of workers) {
        rewriteChains[registry.mappedHref(w.dependentEntryPoint)].push(s =>
            s.replace(
                createWorkerRegex(w.workerUrlPlaceholder),
                `new Worker('${registry.mappedHref(w.workerEntryPoint)}')`,
            ),
        )
    }

    // wait for file reads
    await readingFiles

    // run rewrite regex chain and write back to dist
    await Promise.all(
        Object.entries(bundleOutputs).map(async ([p, content]) => {
            let result = content
            for (const rewriteFn of rewriteChains[p]) {
                result = rewriteFn(result)
            }
            await writeFile(
                join(build.dirs.projectRootAbs, build.dirs.buildDist, p),
                result,
            )
        }),
    )
}

export function createWorkerRegex(workerUrl: string): RegExp {
    return new RegExp(
        `new(?:\\s|\\r?\\n)+Worker(?:\\s|\\r?\\n)*\\((?:\\s|\\r?\\n)*['"]${workerUrl}['"](?:\\s|\\r?\\n)*\\)`,
        'g',
    )
}
