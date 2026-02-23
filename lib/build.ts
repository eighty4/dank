import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadConfig, type ResolvedDankConfig } from './config.ts'
import type { ServiceWorkerBuild, WebsiteManifest } from './dank.ts'
import { type DefineDankGlobal, createGlobalDefinitions } from './define.ts'
import type { DankDirectories } from './dirs.ts'
import { esbuildWebpages, esbuildWorkers } from './esbuild.ts'
import { copyAssets } from './public.ts'
import { WebsiteRegistry } from './registry.ts'

export async function buildWebsite(
    c?: ResolvedDankConfig,
): Promise<WebsiteManifest> {
    if (!c) {
        c = await loadConfig('build', process.cwd())
    }
    console.log(
        c.flags.minify
            ? c.flags.production
                ? 'minified production'
                : 'minified'
            : 'unminified',
        'build',
        await c.buildTag(),
        'building in ./build/dist',
    )
    await rm(c.dirs.buildRoot, { recursive: true, force: true })
    await mkdir(c.dirs.buildDist, { recursive: true })
    for (const subdir of Object.keys(c.pages).filter(url => url !== '/')) {
        await mkdir(join(c.dirs.buildDist, subdir), { recursive: true })
    }
    await mkdir(join(c.dirs.buildRoot, 'metafiles'), { recursive: true })
    const registry = await buildWebpages(c, createGlobalDefinitions(c))
    return await registry.writeManifest()
}

// builds all webpage entrypoints in one esbuild.build context to support code splitting
// returns all built assets URLs and webpage URLs from DankConfig.pages
async function buildWebpages(
    c: ResolvedDankConfig,
    define: DefineDankGlobal,
): Promise<WebsiteRegistry> {
    const registry = new WebsiteRegistry(c)
    registry.configSync()
    registry.copiedAssets = await copyAssets(c.dirs)
    await Promise.all(registry.htmlEntrypoints.map(html => html.process()))
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
    await buildServiceWorker(registry)
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

async function buildServiceWorker(registry: WebsiteRegistry) {
    const serviceWorkerBuilder = registry.config.serviceWorkerBuilder
    if (serviceWorkerBuilder) {
        const website = await registry.manifest()
        const serviceWorkerBuild = await serviceWorkerBuilder({ website })
        validateServiceWorkerBuild(serviceWorkerBuild)
        serviceWorkerBuild.outputs.map(async (output, i) => {
            try {
                return await registry.addBuildOutput(output.url, output.content)
            } catch {
                console.log(
                    `ServiceWorkerBuild.outputs[${i}].url \`${output.url}\` is already a url in the build output.`,
                )
                process.exit(1)
            }
        })
    }
}

function validateServiceWorkerBuild(
    serviceWorkerBuild: ServiceWorkerBuild,
): void | never {
    if (
        serviceWorkerBuild === null ||
        typeof serviceWorkerBuild === 'undefined'
    ) {
        console.log(`ServiceWorkerBuild is ${serviceWorkerBuild}.`)
        console.log(
            '\nMake sure the builder function \`serviceWorker\` in \`dank.config.ts\` is returning a ServiceWorkerBuild.',
        )
        process.exit(1)
    }
    const testUrlPattern = /^\/.*\.js$/
    const valid = true
    serviceWorkerBuild.outputs.forEach((output, i) => {
        if (!output.content?.length) {
            console.log(`ServiceWorkerBuild.outputs[${i}].content is empty.`)
        }
        if (!output.url?.length || !testUrlPattern.test(output.url)) {
            console.log(
                `ServiceWorkerBuild.outputs[${i}].url is not a valid \`/*.js\` path.`,
            )
        }
    })
    if (!valid) {
        console.log(
            '\nCheck your \`serviceWorker\` config in \`dank.config.ts\`.',
        )
        process.exit(1)
    }
}
