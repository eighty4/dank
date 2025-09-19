import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { DankConfig } from './dank.ts'
import { isProductionBuild, willMinify } from './flags.ts'
import { copyAssets } from './public.ts'
import { createBuildTag } from './tag.ts'
import { writeBuildManifest, writeMetafile } from './manifest.ts'
import { type DefineDankGlobal, createGlobalDefinitions } from './define.ts'
import { HtmlEntrypoint } from './html.ts'
import { esbuildWebpages } from './esbuild.ts'

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
    await mkdir(join(buildDir, 'metafiles'), { recursive: true })
    const staticAssets = await copyAssets(distDir)
    const buildUrls: Array<string> = []
    buildUrls.push(
        ...(await buildWebpages(distDir, createGlobalDefinitions(), c.pages)),
    )
    if (staticAssets) {
        buildUrls.push(...staticAssets)
    }
    const result = new Set(buildUrls)
    await writeBuildManifest(buildTag, result)
    return {
        dir: buildDir,
        files: result,
    }
}

async function buildWebpages(
    distDir: string,
    define: DefineDankGlobal,
    pages: Record<string, string>,
): Promise<Array<string>> {
    const entryPointUrls: Set<string> = new Set()
    const entryPoints: Array<{ in: string; out: string }> = []
    const htmlEntrypoints: Array<HtmlEntrypoint> = await Promise.all(
        Object.entries(pages).map(async ([urlPath, fsPath]) => {
            const html = await HtmlEntrypoint.readFrom(
                urlPath,
                join('pages', fsPath),
            )
            await html.injectPartials()
            if (urlPath !== '/') {
                await mkdir(join(distDir, urlPath), { recursive: true })
            }
            html.collectScripts()
                .filter(scriptImport => !entryPointUrls.has(scriptImport.in))
                .forEach(scriptImport => {
                    entryPointUrls.add(scriptImport.in)
                    entryPoints.push({
                        in: scriptImport.in,
                        out: scriptImport.out,
                    })
                })
            return html
        }),
    )
    const metafile = await esbuildWebpages(define, entryPoints, distDir)
    await writeMetafile(`pages.json`, metafile)
    // todo these hrefs would have \ path separators on windows
    const buildUrls = [...Object.keys(pages)]
    const mapInToOutHrefs: Record<string, string> = {}
    for (const [outputFile, { entryPoint }] of Object.entries(
        metafile.outputs,
    )) {
        const outputUrl = outputFile.replace(/^build\/dist/, '')
        buildUrls.push(outputUrl)
        mapInToOutHrefs[entryPoint!] = outputUrl
    }
    await Promise.all(
        htmlEntrypoints.map(async html => {
            html.rewriteHrefs(mapInToOutHrefs)
            await html.writeTo(distDir)
        }),
    )
    return buildUrls
}
