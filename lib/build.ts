import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBuildTag } from './build_tag.ts'
import type { DankConfig } from './dank.ts'
import { type DefineDankGlobal, createGlobalDefinitions } from './define.ts'
import { esbuildWebpages } from './esbuild.ts'
import { isProductionBuild, willMinify } from './flags.ts'
import { HtmlEntrypoint, HtmlHrefs } from './html.ts'
import { writeBuildManifest, writeMetafile } from './manifest.ts'
import { copyAssets } from './public.ts'

export type DankBuild = {
    dir: string
    files: Set<string>
}

export async function buildWebsite(c: DankConfig): Promise<DankBuild> {
    const buildDir = 'build'
    const distDir = join(buildDir, 'dist')
    const buildTag = await createBuildTag()
    console.log(
        willMinify()
            ? isProductionBuild()
                ? 'minified production'
                : 'minified'
            : 'unminified',
        'build',
        buildTag,
        'building in ./build/dist',
    )
    await rm(buildDir, { recursive: true, force: true })
    await mkdir(distDir, { recursive: true })
    for (const subdir of Object.keys(c.pages).filter(url => url !== '/')) {
        await mkdir(join(distDir, subdir), { recursive: true })
    }
    await mkdir(join(buildDir, 'metafiles'), { recursive: true })
    const staticAssets = await copyAssets(distDir)
    const buildUrls: Array<string> = await buildWebpages(
        distDir,
        createGlobalDefinitions(),
        c.pages,
    )
    if (staticAssets) {
        buildUrls.push(...staticAssets)
    }
    const result = new Set(buildUrls)
    await writeBuildManifest(buildTag, result)
    return {
        dir: distDir,
        files: result,
    }
}

// builds all webpage entrypoints in one esbuild.build context
// to support code splitting
// returns all built assets URLs and webpage URLs from DankConfig.pages
async function buildWebpages(
    distDir: string,
    define: DefineDankGlobal,
    pages: Record<string, string>,
): Promise<Array<string>> {
    // create HtmlEntrypoint for each webpage and collect awaitable esbuild entrypoints
    const loadingEntryPoints: Array<
        Promise<Array<{ in: string; out: string }>>
    > = []
    const htmlEntrypoints: Array<HtmlEntrypoint> = []
    for (const [urlPath, fsPath] of Object.entries(pages)) {
        const html = new HtmlEntrypoint(urlPath, fsPath)
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

    const metafile = await esbuildWebpages(define, buildEntryPoints, distDir)
    await writeMetafile(`pages.json`, metafile)

    // write out html output with rewritten hrefs
    const hrefs = new HtmlHrefs()
    hrefs.addEsbuildOutputs(metafile)
    await Promise.all(
        htmlEntrypoints.map(async html => {
            await writeFile(
                join(distDir, html.url, 'index.html'),
                html.output(hrefs),
            )
        }),
    )

    // return website urls of webpages and assets
    return [...Object.keys(pages), ...hrefs.buildOutputUrls]
}
