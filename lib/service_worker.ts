import { join } from 'node:path'
import esbuild from 'esbuild'
import type { ServiceWorkerBuild } from './dank.ts'

export type ServiceWorkerCaching = {
    cacheKey: string
    bypassCache?: {
        hosts?: Array<string>
        paths?: Array<`/${string}`>
    }
    files: Array<`/${string}`>
}

export async function createServiceWorker(
    caching: ServiceWorkerCaching,
): Promise<ServiceWorkerBuild> {
    return {
        outputs: [
            {
                content: await buildServiceWorkerBackend(caching),
                url: '/sw.js',
            },
        ],
    }
}

async function buildServiceWorkerBackend(
    caching: ServiceWorkerCaching,
): Promise<string> {
    const result = await esbuild.build({
        logLevel: 'silent',
        absWorkingDir: join(import.meta.dirname, '../client'),
        entryPoints: ['ServiceWorker.ts'],
        treeShaking: true,
        target: 'ES2022',
        bundle: true,
        minify: true,
        format: 'iife',
        platform: 'browser',
        write: false,
        metafile: true,
        plugins: [
            {
                name: 'DANK:sw',
                setup(build: esbuild.PluginBuild) {
                    build.onResolve({ filter: /DANK:sw/ }, () => {
                        return {
                            path: join(import.meta.dirname, 'DANK.sw.json'),
                        }
                    })
                    build.onLoad(
                        { filter: /DANK\.sw\.json$/, namespace: 'file' },
                        async () => ({
                            contents: JSON.stringify(caching),
                            loader: 'json',
                        }),
                    )
                },
            },
        ],
    })
    return new TextDecoder().decode(result.outputFiles[0].contents)
}
