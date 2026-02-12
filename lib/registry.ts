import EventEmitter from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path/posix'
import type { BuildResult } from 'esbuild'
import type { ResolvedDankConfig } from './config.ts'
import type { PageMapping } from './dank.ts'
import { LOG } from './developer.ts'
import { Resolver, type DankDirectories } from './dirs.ts'
import type { EntryPoint } from './esbuild.ts'
import { HtmlEntrypoint } from './html.ts'

// summary of a website build
export type WebsiteManifest = {
    buildTag: string
    files: Set<string>
    pageUrls: Set<string>
}

// result of an esbuild build from the context of the config's entrypoints
// path of entrypoint is the reference point to lookup from a dependent page
export type BuildManifest = {
    // css and js bundles mapping output path to
    // entrypoint path or null for code splitting chunks
    bundles: Record<string, string | null>

    // web worker urls mapped by dependent entrypoints
    // to be built with a subsequent esbuild context
    workers: Array<WorkerManifest> | null
}

type OnBuildComplete = (manifest: BuildManifest) => void

type WorkerManifest = {
    // path to module dependent on worker
    clientScript: string
    // path to bundled entrypoint dependent on `clientScript`
    dependentEntryPoint: string
    workerEntryPoint: string
    workerCtor: 'Worker' | 'SharedWorker'
    workerUrl: string
    workerUrlPlaceholder: string
}

export type WebsiteRegistryEvents = {
    entrypoints: []
    webpage: [entrypoint: HtmlEntrypoint]
    workers: []
}

type WebpageRegistration = {
    pageUrl: `/${string}`
    fsPath: string
    html: HtmlEntrypoint
    bundles: Array<EntryPoint>
    urlRewrite?: UrlRewrite
}

export type UrlRewrite = {
    pattern: RegExp
    url: string
}

export type UrlRewriteProvider = {
    urlRewrites: Array<UrlRewrite>
}

// manages website resources during `dank build` and `dank serve`
export class WebsiteRegistry extends EventEmitter<WebsiteRegistryEvents> {
    // paths of bundled esbuild outputs, as built by esbuild
    #bundles: Set<string> = new Set()
    #c: ResolvedDankConfig
    // public dir assets
    #copiedAssets: Set<string> | null = null
    // map of entrypoints to their output path
    #entrypointHrefs: Record<string, string | null> = {}
    #pages: Record<`/${string}`, WebpageRegistration> = {}
    readonly #resolver: Resolver
    #workers: Array<WorkerManifest> | null = null

    constructor(config: ResolvedDankConfig) {
        super()
        this.#c = config
        this.#resolver = Resolver.create(config.dirs)
    }

    get config(): ResolvedDankConfig {
        return this.#c
    }

    set copiedAssets(copiedAssets: Array<string> | null) {
        this.#copiedAssets =
            copiedAssets === null ? null : new Set(copiedAssets)
    }

    get htmlEntrypoints(): Array<HtmlEntrypoint> {
        return Object.values(this.#pages).map(p => p.html)
    }

    get pageUrls(): Array<string> {
        return Object.keys(this.#pages)
    }

    get resolver(): Resolver {
        return this.#resolver
    }

    get urlRewrites(): Array<UrlRewrite> {
        return Object.values(this.#pages)
            .filter(
                (pr): pr is WebpageRegistration & { urlRewrite: UrlRewrite } =>
                    typeof pr.urlRewrite !== 'undefined',
            )
            .map(pr => pr.urlRewrite)
    }

    get webpageEntryPoints(): Array<EntryPoint> {
        const unique: Set<EntryPoint['in']> = new Set()
        return Object.values(this.#pages)
            .flatMap(p => p.bundles)
            .filter(entryPoint => {
                if (unique.has(entryPoint.in)) {
                    return false
                } else {
                    unique.add(entryPoint.in)
                    return true
                }
            })
    }

    get webpageAndWorkerEntryPoints(): Array<EntryPoint> {
        const unique: Set<EntryPoint['in']> = new Set()
        const pageBundles = Object.values(this.#pages).flatMap(p => p.bundles)
        const workerBundles = this.workerEntryPoints
        const bundles = workerBundles
            ? [...pageBundles, ...workerBundles]
            : pageBundles
        return bundles.filter(entryPoint => {
            if (unique.has(entryPoint.in)) {
                return false
            } else {
                unique.add(entryPoint.in)
                return true
            }
        })
    }

    get workerEntryPoints(): Array<EntryPoint> | null {
        return (
            this.#workers?.map(({ workerEntryPoint }) => ({
                in: workerEntryPoint,
                out: workerEntryPoint
                    .replace(/^pages[\//]/, '')
                    .replace(/\.(mj|t)s$/, '.js'),
            })) || null
        )
    }

    get workers(): Array<WorkerManifest> | null {
        return this.#workers
    }

    buildRegistry(): BuildRegistry {
        return new BuildRegistry(
            this.#c.dirs,
            this.#resolver,
            this.#onBuildManifest,
        )
    }

    configSync() {
        this.#configDiff()
    }

    files(): Set<string> {
        const files = new Set<string>()
        for (const pageUrl of Object.keys(this.#pages))
            files.add(pageUrl === '/' ? '/index.html' : `${pageUrl}/index.html`)
        for (const f of this.#bundles) files.add(f)
        if (this.#copiedAssets) for (const f of this.#copiedAssets) files.add(f)
        return files
    }

    mappedHref(lookup: string): string {
        const found = this.#entrypointHrefs[lookup]
        if (found) {
            return found
        } else {
            throw Error(`mapped href for ${lookup} not found`)
        }
    }

    async writeManifest(buildTag: string): Promise<WebsiteManifest> {
        const manifest = this.#manifest(buildTag)
        await writeFile(
            join(
                this.#c.dirs.projectRootAbs,
                this.#c.dirs.buildRoot,
                'website.json',
            ),
            JSON.stringify(
                {
                    buildTag,
                    files: Array.from(manifest.files),
                    pageUrls: Array.from(manifest.pageUrls),
                },
                null,
                4,
            ),
        )
        return manifest
    }

    #configDiff() {
        const updatePages: ResolvedDankConfig['pages'] = this.#c.devPages
            ? { ...this.#c.pages, ...this.#c.devPages }
            : { ...this.#c.pages }
        const prevPages = new Set(Object.keys(this.#pages))
        for (const [urlPath, mapping] of Object.entries(updatePages)) {
            const existingPage = prevPages.delete(urlPath as `/${string}`)
            if (existingPage) {
                this.#configPageUpdate(urlPath as `/${string}`, mapping)
            } else {
                this.#configPageAdd(urlPath as `/${string}`, mapping)
            }
        }
        for (const prevPage of prevPages) {
            this.#configPageRemove(prevPage as `/${string}`)
        }
    }

    #configPageAdd(urlPath: `/${string}`, mapping: PageMapping) {
        LOG({
            realm: 'registry',
            message: 'added page',
            data: {
                urlPath,
                srcPath: mapping.webpage,
            },
        })
        const html = new HtmlEntrypoint(
            this.#c,
            this.#resolver,
            urlPath as `/${string}`,
            mapping.webpage,
        )
        const urlRewrite = mapping.pattern
            ? { pattern: mapping.pattern, url: urlPath }
            : undefined
        this.#pages[urlPath as `/${string}`] = {
            pageUrl: urlPath as `/${string}`,
            fsPath: mapping.webpage,
            html,
            urlRewrite,
            bundles: [],
        }
        html.on('entrypoints', entrypoints =>
            this.#setWebpageBundles(html.url, entrypoints),
        )
        this.emit('webpage', html)
        html.emit('change')
    }

    #configPageUpdate(urlPath: `/${string}`, mapping: PageMapping) {
        const existingRegistration = this.#pages[urlPath as `/${string}`]
        if (existingRegistration.fsPath !== mapping.webpage) {
            this.#configPageRemove(urlPath)
            this.#configPageAdd(urlPath, mapping)
        } else if (
            existingRegistration.urlRewrite?.pattern.source !==
            mapping.pattern?.source
        ) {
            if (mapping.pattern) {
                existingRegistration.urlRewrite = {
                    url: urlPath,
                    pattern: mapping.pattern,
                }
            } else {
                existingRegistration.urlRewrite = undefined
            }
        }
        LOG({
            realm: 'registry',
            message: 'updated page src',
            data: {
                urlPath,
                newSrcPath: mapping.webpage,
                oldSrcPath: this.#pages[urlPath as `/${string}`].fsPath,
            },
        })
    }

    #configPageRemove(urlPath: `/${string}`) {
        const registration = this.#pages[urlPath]
        LOG({
            realm: 'registry',
            message: 'removed page',
            data: {
                urlPath,
                srcPath: registration.fsPath,
            },
        })
        registration.html.removeAllListeners()
        delete this.#pages[urlPath]
    }

    #manifest(buildTag: string): WebsiteManifest {
        return {
            buildTag,
            files: this.files(),
            pageUrls: new Set(Object.keys(this.#pages)),
        }
    }

    #onBuildManifest: OnBuildComplete = (build: BuildManifest) => {
        // collect built bundle entrypoint hrefs
        for (const [outPath, entrypoint] of Object.entries(build.bundles)) {
            this.#bundles.add(outPath)
            if (entrypoint) {
                this.#entrypointHrefs[entrypoint] = outPath
            }
        }

        // determine if worker entrypoints have changed
        let updatedWorkerEntrypoints = false
        const previousWorkers =
            this.#workers === null
                ? null
                : new Set(this.#workers.map(w => w.workerEntryPoint))
        if (build.workers) {
            if (
                !previousWorkers ||
                previousWorkers.size !==
                    new Set(build.workers.map(w => w.workerEntryPoint)).size
            ) {
                updatedWorkerEntrypoints = true
            } else {
                updatedWorkerEntrypoints = !build.workers.every(w =>
                    previousWorkers.has(w.workerEntryPoint),
                )
            }
        } else if (previousWorkers) {
            updatedWorkerEntrypoints = true
        }

        // merge unique entrypoints from built workers with registry state
        // todo filtering out unique occurrences of clientScript and workerUrl
        //  drops reporting/summary/debugging capabilities, but currently
        //  this.#workers is used for unique worker/client entrypoints
        if (build.workers) {
            if (!this.#workers) {
                this.#workers = build.workers
            } else {
                for (const w of build.workers) {
                    const found = this.#workers.find(w2 => {
                        return (
                            w.dependentEntryPoint === w2.dependentEntryPoint &&
                            w.workerEntryPoint === w2.workerEntryPoint
                        )
                    })
                    if (!found) {
                        this.#workers.push(w)
                    }
                }
            }
        }

        if (updatedWorkerEntrypoints) {
            this.emit('workers')
        }
    }

    #setWebpageBundles(url: `/${string}`, bundles: Array<EntryPoint>) {
        this.#pages[url].bundles = bundles
        this.emit('entrypoints')
    }
}

// result accumulator of an esbuild `build` or `Context.rebuild`
export class BuildRegistry {
    #dirs: DankDirectories
    #onComplete: OnBuildComplete
    #resolver: Resolver
    #workers: Array<Omit<WorkerManifest, 'dependentEntryPoint'>> | null = null

    constructor(
        dirs: DankDirectories,
        resolver: Resolver,
        onComplete: (manifest: BuildManifest) => void,
    ) {
        this.#dirs = dirs
        this.#onComplete = onComplete
        this.#resolver = resolver
    }

    get dirs(): DankDirectories {
        return this.#dirs
    }

    get resolver(): Resolver {
        return this.#resolver
    }

    addWorker(worker: Omit<WorkerManifest, 'dependentEntryPoint'>) {
        if (!this.#workers) {
            this.#workers = [worker]
        } else {
            this.#workers.push(worker)
        }
    }

    completeBuild(result: BuildResult<{ metafile: true }>) {
        const bundles: Record<string, string | null> = {}
        for (const [outPath, output] of Object.entries(
            result.metafile.outputs,
        )) {
            bundles[outPath.replace(/^build[/\\]dist/, '')] =
                output.entryPoint || null
        }
        let workers: BuildManifest['workers'] = null
        if (this.#workers) {
            workers = []
            for (const output of Object.values(result.metafile.outputs)) {
                if (!output.entryPoint) continue
                const inputs = Object.keys(output.inputs)
                for (const worker of this.#workers) {
                    if (inputs.includes(worker.clientScript)) {
                        workers.push({
                            ...worker,
                            dependentEntryPoint: output.entryPoint,
                        })
                    }
                }
            }
        }
        this.#onComplete({
            bundles,
            workers,
        })
    }
}
