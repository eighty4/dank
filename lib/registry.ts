import EventEmitter from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path/posix'
import type { Metafile } from 'esbuild'
import type { ResolvedDankConfig } from './config.ts'
import type { PageMapping, WebsiteManifest } from './dank.ts'
import { LOG } from './developer.ts'
import { Resolver, type DankDirectories } from './dirs.ts'
import { DankError } from './errors.ts'
import type { EsbuildEntrypoint } from './esbuild.ts'
import { HtmlEntrypoint } from './html.ts'

export type EntrypointManifest = {
    cssBundle?: `/${string}`
    // matches EsbuildEntrypoint['in'] of WebpageRegistration
    entrypoint: string
    // outputs paths in dist dir
    sharedChunks: Array<`/${string}`>
    urlPath: `/${string}`
}

export type WorkerManifest = {
    // path to bundle containing `clientScript`
    clientEntrypoint: string
    // path to script with Worker ctor call
    clientScript: string
    ctor: 'Worker' | 'SharedWorker'
    entrypoint: EsbuildEntrypoint
    placeholderCtorSrc: `/${string}`
    originalCtorSrc: string
}

type WebpageRegistration = {
    pageUrl: `/${string}`
    fsPath: string
    html: HtmlEntrypoint
    bundleEntrypoints: Array<EsbuildEntrypoint>
    urlRewrite?: UrlRewrite
}

export type UrlRewrite = {
    pattern: RegExp
    url: string
}

export type WebsiteRegistryEvents = {
    // webpage css & js entrypoints changed
    entrypoints: []
    // webpage added to website registry
    webpage: [entrypoint: HtmlEntrypoint]
    // website worker entrypoints changed
    workers: []
}

// manages website resources during `dank build` and `dank serve`
export class WebsiteRegistry extends EventEmitter<WebsiteRegistryEvents> {
    // paths of bundled esbuild outputs mapped to entrypoint metadata
    #bundles: Record<`/${string}`, EntrypointManifest> = {}
    #c: ResolvedDankConfig
    // public dir assets
    #copiedAssets: Set<`/${string}`> | null = null
    // map of entrypoints to their hashed output paths
    // includes all hrefs found in <script src>, <link href> and Worker URLs
    // (excluding css bundles built from a js entrypoint)
    #entrypointHrefs: Record<string, string | null> = {}
    #otherOutputs: Set<`/${string}`> | null = null
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

    set copiedAssets(copiedAssets: Array<`/${string}`> | null) {
        this.#copiedAssets =
            copiedAssets === null ? null : new Set(copiedAssets)
    }

    get htmlEntrypoints(): Array<HtmlEntrypoint> {
        return Object.values(this.#pages).map(p => p.html)
    }

    async manifest(): Promise<WebsiteManifest> {
        return {
            buildTag: await this.#c.buildTag(),
            files: this.files(),
            pageUrls: Object.keys(this.#pages) as Array<`/${string}`>,
        }
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

    get webpageEntryPoints(): Array<EsbuildEntrypoint> {
        const unique: Set<EsbuildEntrypoint['in']> = new Set()
        return Object.values(this.#pages)
            .flatMap(p => p.bundleEntrypoints)
            .filter(entryPoint => {
                if (unique.has(entryPoint.in)) {
                    return false
                } else {
                    unique.add(entryPoint.in)
                    return true
                }
            })
    }

    get webpageAndWorkerEntryPoints(): Array<EsbuildEntrypoint> {
        const unique: Set<EsbuildEntrypoint['in']> = new Set()
        const pageBundles = Object.values(this.#pages).flatMap(
            p => p.bundleEntrypoints,
        )
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

    get workerEntryPoints(): Array<EsbuildEntrypoint> | null {
        return this.#workers?.map(w => w.entrypoint) || null
    }

    get workers(): Array<WorkerManifest> | null {
        return this.#workers
    }

    // explicit add build output to registry & write to build/dist
    // not from HTML processing, public directory, or esbuild entrypoints
    async addBuildOutput(url: `/${string}`, content: string) {
        if (
            this.#pages[url] ||
            this.#bundles[url] ||
            this.#otherOutputs?.has(url) ||
            this.#copiedAssets?.has(url)
        ) {
            throw Error('build already has a ' + url)
        }
        if (this.#otherOutputs === null) this.#otherOutputs = new Set()
        this.#otherOutputs.add(url)
        const outputPath = join(
            this.#c.dirs.projectRootAbs,
            this.#c.dirs.buildDist,
            url,
        )
        await writeFile(outputPath, content)
    }

    workerRegistry(): WorkerBuildRegistry {
        return new WorkerBuildRegistry(this.#c.dirs, this.#resolver)
    }

    configSync() {
        this.#configDiff()
    }

    files(): Array<`/${string}`> {
        const htmlPages = Object.keys(this.#pages).map(pageUrl =>
            pageUrl === '/'
                ? '/index.html'
                : (`${pageUrl}/index.html` as `/${string}`),
        )
        const entrypoints = new Set<`/${string}`>()
        const chunks = new Set<`/${string}`>()
        for (const b of Object.values(this.#bundles)) {
            entrypoints.add(b.urlPath)
            if (b.cssBundle) entrypoints.add(b.cssBundle)
            for (const c of b.sharedChunks) {
                chunks.add(c)
            }
        }
        let assets = new Set<`/${string}`>()
        for (const ac of [this.#copiedAssets, this.#otherOutputs]) {
            if (ac) {
                const overlap = ac.intersection(assets)
                if (overlap.size)
                    throw new DankError(
                        'website assets duplicated in website registry: ' +
                            Array.from(overlap).join(', '),
                    )
                assets = ac.union(assets)
            }
        }
        return [...htmlPages, ...entrypoints, ...chunks, ...assets]
    }

    hasWebWorkers(): boolean {
        return !!this.#workers?.length
    }

    mappedHref(lookup: string): string {
        const found = this.#entrypointHrefs[lookup]
        if (found) {
            return found
        } else {
            throw new DankError(`mapped href for ${lookup} not found`)
        }
    }

    mergeDevContext(build: Metafile, workerRegistry: WorkerBuildRegistry) {
        this.mergeBuiltBundles(build)
        this.mergeWorkerRegistry(build, workerRegistry)
    }

    mergeBuiltBundles(build: Metafile): void {
        for (const [outPath, output] of Object.entries(build.outputs)) {
            if (!output.entryPoint) {
                if (output.cssBundle) {
                    throw new DankError(
                        'unprepared scenario of a shared chunk outputting a css bundle',
                    )
                }
                continue
            }
            const urlPath = stripBuildDir(outPath)
            const previousCssBundle = this.#bundles[urlPath]?.cssBundle
            this.#entrypointHrefs[output.entryPoint] = urlPath
            const entrypoint: EntrypointManifest = (this.#bundles[urlPath] = {
                entrypoint: output.entryPoint,
                sharedChunks: output.imports.map(i => stripBuildDir(i.path)),
                urlPath,
            })
            if (output.cssBundle) {
                entrypoint.cssBundle = stripBuildDir(output.cssBundle)
            }
            if (output.cssBundle !== previousCssBundle) {
                for (const webpage of this.#webpagesWithEntrypoint(
                    entrypoint.entrypoint,
                )) {
                    webpage.html.setCssBundle(
                        entrypoint.entrypoint,
                        entrypoint.cssBundle || null,
                    )
                }
            }
        }
    }

    mergeWorkerRegistry(build: Metafile, workerRegistry: WorkerBuildRegistry) {
        const workers = workerRegistry.resolveWorkers(build)
        // determine if worker entrypoints have changed before merging
        const updatedWorkerEntrypoints =
            this.#doesBuildUpdateWorkerEntrypoints(workers)
        LOG({
            realm: 'registry',
            message: 'build completed',
            data: {
                updatedWorkerEntrypoints,
                workers: workers?.length || 0,
            },
        })
        this.#workers = workers
        if (updatedWorkerEntrypoints) {
            this.emit('workers')
        }
    }

    #doesBuildUpdateWorkerEntrypoints(
        workers: Array<Omit<WorkerManifest, 'clientEntrypoint'>> | null,
    ): boolean {
        if (this.#workers && workers) {
            const next = new Set(workers.map(w => w.entrypoint.in))
            const prev = new Set(this.#workers.map(w => w.entrypoint.in))
            return (
                next.size !== prev.size ||
                next.symmetricDifference(prev).size !== 0
            )
        } else {
            return this.#workers !== null || workers !== null
        }
    }

    async writeManifest(): Promise<WebsiteManifest> {
        const manifest = await this.#manifest()
        await writeFile(
            join(
                this.#c.dirs.projectRootAbs,
                this.#c.dirs.buildRoot,
                'website.json',
            ),
            JSON.stringify(manifest, null, 4),
        )
        await writeFile(
            join(
                this.#c.dirs.projectRootAbs,
                this.#c.dirs.buildRoot,
                'workers.json',
            ),
            JSON.stringify(this.#workers || [], null, 4),
        )
        return manifest
    }

    #configDiff() {
        const prevPages = new Set(Object.keys(this.#pages))
        for (const [urlPath, mapping] of Object.entries(
            this.#c.pageMappings(),
        )) {
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
            bundleEntrypoints: [],
        }
        html.on('entrypoints', entrypoints =>
            this.#setWebpageBundleEntrypoints(html.url, entrypoints),
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

    async #manifest(): Promise<WebsiteManifest> {
        return {
            buildTag: await this.#c.buildTag(),
            files: this.files(),
            pageUrls: Object.keys(this.#pages) as Array<`/${string}`>,
        }
    }

    #setWebpageBundleEntrypoints(
        url: `/${string}`,
        entrypoints: Array<EsbuildEntrypoint>,
    ) {
        this.#pages[url].bundleEntrypoints = entrypoints
        this.emit('entrypoints')
    }

    #webpagesWithEntrypoint(
        entrypoint: EsbuildEntrypoint['in'],
    ): Array<WebpageRegistration> {
        return Object.values(this.#pages).filter(webpage =>
            webpage.bundleEntrypoints.some(
                webpageBundle => webpageBundle.in === entrypoint,
            ),
        )
    }
}

// result accumulator of an esbuild `build` or `Context.rebuild`
export class WorkerBuildRegistry {
    #dirs: DankDirectories
    #resolver: Resolver
    #workers: Array<Omit<WorkerManifest, 'clientEntrypoint'>> | null = null

    constructor(dirs: DankDirectories, resolver: Resolver) {
        this.#dirs = dirs
        this.#resolver = resolver
    }

    get dirs(): DankDirectories {
        return this.#dirs
    }

    get resolver(): Resolver {
        return this.#resolver
    }

    // map unique finds of modules creating workers via worker ctor
    // to entrypoints bundling those `clientScript` modules
    resolveWorkers(build: Metafile): Array<WorkerManifest> | null {
        if (!this.#workers) {
            return null
        }
        const workers: Array<WorkerManifest> = []
        for (const output of Object.values(build.outputs)) {
            if (!output.entryPoint) continue
            const inputs = Object.keys(output.inputs)
            for (const worker of this.#workers) {
                if (inputs.includes(worker.clientScript)) {
                    workers.push({
                        ...worker,
                        clientEntrypoint: output.entryPoint,
                    })
                }
            }
        }
        return workers
    }

    addWorker(worker: Omit<WorkerManifest, 'clientEntrypoint'>) {
        if (!this.#workers) {
            this.#workers = [worker]
        } else {
            this.#workers.push(worker)
        }
    }
}

const stripBuildDirPattern = /^build[/\\](dist|watch)/

function stripBuildDir(p: string): `/${string}` {
    return ensureWebPath(p.replace(stripBuildDirPattern, ''))
}

function ensureWebPath(path: string): `/${string}` {
    if (path.startsWith('/')) {
        return path as `/${string}`
    } else {
        throw Error(`expect build dist path ${path} to start with /`)
    }
}
