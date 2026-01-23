import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBuildTag } from './build_tag.ts'
import { loadConfig, type ResolvedDankConfig } from './config.ts'
import { type DefineDankGlobal, createGlobalDefinitions } from './define.ts'
import type { DankDirectories } from './dirs.ts'
import { esbuildWebpages, esbuildWorkers } from './esbuild.ts'
import { copyAssets } from './public.ts'
import { type WebsiteManifest, WebsiteRegistry } from './registry.ts'

export async function buildWebsite(
    c?: ResolvedDankConfig,
): Promise<WebsiteManifest> {
    if (!c) {
        c = await loadConfig('build', process.cwd())
    }
    const buildTag = await createBuildTag(c.flags)
    console.log(
        c.flags.minify
            ? c.flags.production
                ? 'minified production'
                : 'minified'
            : 'unminified',
        'build',
        buildTag,
        'building in ./build/dist',
    )
    await rm(c.dirs.buildRoot, { recursive: true, force: true })
    await mkdir(c.dirs.buildDist, { recursive: true })
    for (const subdir of Object.keys(c.pages).filter(url => url !== '/')) {
        await mkdir(join(c.dirs.buildDist, subdir), { recursive: true })
    }
    await mkdir(join(c.dirs.buildRoot, 'metafiles'), { recursive: true })
    const registry = await buildWebpages(c, createGlobalDefinitions(c))
    return await registry.writeManifest(buildTag)
}

// builds all webpage entrypoints in one esbuild.build context to support code splitting
// returns all built assets URLs and webpage URLs from DankConfig.pages
async function buildWebpages(
    c: ResolvedDankConfig,
    define: DefineDankGlobal,
): Promise<WebsiteRegistry> {
    const registry = new WebsiteRegistry(c)
    registry.copiedAssets = await copyAssets(c.dirs)
    await registry.htmlProcessed
    await esbuildWebpages(registry, define, registry.webpageEntryPoints)

    // todo recursively build workers on building workers that create workers
    const workerEntryPoints = registry.workerEntryPoints
    if (workerEntryPoints?.length) {
        await esbuildWorkers(registry, define, workerEntryPoints)
    }
    await rewriteWorkerUrls(c.dirs, registry)

    // write out html output with rewritten hrefs
    await Promise.all(
        registry.htmlEntrypoints.map(async html => {
            await writeFile(
                join(c.dirs.buildDist, html.url, 'index.html'),
                html.output(registry),
            )
        }),
    )
    return registry
}

export async function rewriteWorkerUrls(
    dirs: DankDirectories,
    registry: WebsiteRegistry,
) {
    const workers = registry.workers
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
                join(dirs.projectRootAbs, dirs.buildDist, p),
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
                createWorkerRegex(w.workerCtor, w.workerUrlPlaceholder),
                `new ${w.workerCtor}('${registry.mappedHref(w.workerEntryPoint)}')`,
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
                join(dirs.projectRootAbs, dirs.buildDist, p),
                result,
            )
        }),
    )
}

export function createWorkerRegex(
    workerCtor: 'Worker' | 'SharedWorker',
    workerUrl: string,
): RegExp {
    return new RegExp(
        `new(?:\\s|\\r?\\n)+${workerCtor}(?:\\s|\\r?\\n)*\\((?:\\s|\\r?\\n)*['"]${workerUrl}['"](?:\\s|\\r?\\n)*\\)`,
        'g',
    )
}
