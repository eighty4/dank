import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBuildTag } from './build_tag.ts'
import type { DankConfig } from './dank.ts'
import { type DefineDankGlobal, createGlobalDefinitions } from './define.ts'
import { esbuildWebpages } from './esbuild.ts'
import { resolveBuildFlags, type DankBuild } from './flags.ts'
import { HtmlEntrypoint, HtmlHrefs } from './html.ts'
import { writeBuildManifest, writeMetafile } from './manifest.ts'
import { copyAssets } from './public.ts'

export type DankBuildSummary = {
    dir: string
    files: Set<string>
}

export async function buildWebsite(
    c: DankConfig,
    build: DankBuild = resolveBuildFlags(),
): Promise<DankBuildSummary> {
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
    const staticAssets = await copyAssets(build)
    const buildUrls: Array<string> = await buildWebpages(
        c,
        build,
        createGlobalDefinitions(build),
    )
    if (staticAssets) {
        buildUrls.push(...staticAssets)
    }
    const result = new Set(buildUrls)
    await writeBuildManifest(build, buildTag, result)
    return {
        dir: build.dirs.buildDist,
        files: result,
    }
}

// builds all webpage entrypoints in one esbuild.build context
// to support code splitting
// returns all built assets URLs and webpage URLs from DankConfig.pages
async function buildWebpages(
    c: DankConfig,
    build: DankBuild,
    define: DefineDankGlobal,
): Promise<Array<string>> {
    // create HtmlEntrypoint for each webpage and collect awaitable esbuild entrypoints
    const loadingEntryPoints: Array<
        Promise<Array<{ in: string; out: string }>>
    > = []
    const htmlEntrypoints: Array<HtmlEntrypoint> = []
    for (const [urlPath, mapping] of Object.entries(c.pages)) {
        const fsPath = typeof mapping === 'string' ? mapping : mapping.webpage
        const html = new HtmlEntrypoint(build, urlPath, fsPath)
        loadingEntryPoints.push(new Promise(res => html.on('entrypoints', res)))
        htmlEntrypoints.push(html)
    }

    // collect esbuild entrypoints from every HtmlEntrypoint
    const uniqueEntryPoints: Set<string> = new Set()
    const buildEntryPoints: Array<{ in: string; out: string }> = []
    for (const pageEntryPoints of await Promise.all(loadingEntryPoints)) {
        for (const entryPoint of pageEntryPoints) {
            if (!uniqueEntryPoints.has(entryPoint.in)) {
                buildEntryPoints.push(entryPoint)
            }
        }
    }

    const metafile = await esbuildWebpages(
        build,
        define,
        buildEntryPoints,
        c.esbuild,
    )
    await writeMetafile(build, `pages.json`, metafile)

    // write out html output with rewritten hrefs
    const hrefs = new HtmlHrefs()
    hrefs.addEsbuildOutputs(metafile)
    await Promise.all(
        htmlEntrypoints.map(async html => {
            await writeFile(
                join(build.dirs.buildDist, html.url, 'index.html'),
                html.output(hrefs),
            )
        }),
    )

    // return website urls of webpages and assets
    return [...Object.keys(c.pages), ...hrefs.buildOutputUrls]
}
