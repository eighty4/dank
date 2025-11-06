import EventEmitter from 'node:events'
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { BuildResult } from 'esbuild'
import type { EntryPoint } from './esbuild.ts'
import type { DankBuild } from './flags.ts'

export type Resolver = {
    resolve(from: string, href: string): string | 'outofbounds'
}

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
    workerUrl: string
    workerUrlPlaceholder: string
}

export type WebsiteRegistryEvents = {
    workers: []
}

// manages website resources during `dank build` and `dank serve`
export class WebsiteRegistry
    extends EventEmitter<WebsiteRegistryEvents>
    implements Resolver
{
    #build: DankBuild
    // paths of bundled esbuild outputs
    #bundles: Set<string> = new Set()
    // public dir assets
    #copiedAssets: Set<string> | null = null
    // map of entrypoints to their output path
    #entrypointHrefs: Record<string, string | null> = {}
    #pageUrls: Array<string> = []
    #workers: Array<WorkerManifest> | null = null

    constructor(build: DankBuild) {
        super()
        this.#build = build
    }

    // bundleOutputs(type?: 'css' | 'js'): Array<string> {
    //     if (!type) {
    //         return Array.from(this.#bundles)
    //     } else {
    //         return Array.from(this.#bundles).filter(p => p.endsWith(type))
    //     }
    // }

    buildRegistry(): BuildRegistry {
        return new BuildRegistry(this.#build, this.#onBuildManifest)
    }

    files(): Set<string> {
        const files = new Set<string>()
        for (const pageUrl of this.#pageUrls)
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

    resolve(from: string, href: string): string {
        return resolveImpl(this.#build, from, href)
    }

    workerEntryPoints(): Array<EntryPoint> | null {
        return (
            this.#workers?.map(({ workerEntryPoint }) => ({
                in: workerEntryPoint,
                out: workerEntryPoint
                    .replace(/^pages[\//]/, '')
                    .replace(/\.(mj|t)s$/, '.js'),
            })) || null
        )
    }

    workers(): Array<WorkerManifest> | null {
        return this.#workers
    }

    async writeManifest(buildTag: string): Promise<WebsiteManifest> {
        const manifest = this.#manifest(buildTag)
        await writeFile(
            join(
                this.#build.dirs.projectRootAbs,
                this.#build.dirs.buildRoot,
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

    set copiedAssets(copiedAssets: Array<string> | null) {
        this.#copiedAssets =
            copiedAssets === null ? null : new Set(copiedAssets)
    }

    set pageUrls(pageUrls: Array<string>) {
        this.#pageUrls = pageUrls
    }

    #manifest(buildTag: string): WebsiteManifest {
        return {
            buildTag,
            files: this.files(),
            pageUrls: new Set(this.#pageUrls),
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
}

// result accumulator of an esbuild `build` or `Context.rebuild`
export class BuildRegistry implements Resolver {
    #build: DankBuild
    #onComplete: OnBuildComplete
    #workers: Array<Omit<WorkerManifest, 'dependentEntryPoint'>> | null = null

    constructor(
        build: DankBuild,
        onComplete: (manifest: BuildManifest) => void,
    ) {
        this.#build = build
        this.#onComplete = onComplete
    }

    // resolve web worker imported by a webpage module
    addWorker(worker: Omit<WorkerManifest, 'dependentEntryPoint'>) {
        // todo normalize path
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

    resolve(from: string, href: string): string {
        return resolveImpl(this.#build, from, href)
    }
}

function resolveImpl(build: DankBuild, from: string, href: string): string {
    const { pagesResolved, projectRootAbs } = build.dirs
    const fromDir = dirname(from)
    const resolvedFromProjectRoot = join(projectRootAbs, fromDir, href)
    if (!resolve(resolvedFromProjectRoot).startsWith(pagesResolved)) {
        throw Error(
            `href ${href} cannot be resolved from pages${sep}${from} to a path outside of the pages directory`,
        )
    } else {
        return join(fromDir, href)
    }
}
