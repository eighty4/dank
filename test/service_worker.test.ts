import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { suite, test } from 'node:test'
import { createDank } from './dank_project_testing.ts'
import { createServiceWorker } from '../lib/service_worker.ts'

suite('Service workers', () => {
    suite('dank build', () => {
        test('adds service worker to dist and manifest', async () => {
            const project = await createDank()
            project.writeConfig(`\
import { createServiceWorker } from '@eighty4/dank'
export default {
    pages: {
        '/': './dank.html',
    },
    serviceWorker: async ({website}) => await createServiceWorker({
        cacheKey: website.buildTag,
        files: Array.from(website.files),
    }),
}
`)
            await project.build()
            assert.ok(await project.readFromBuild('sw.js'))
            const manifest = await project.readManifest()
            assert.ok(manifest.files.includes('/sw.js'))
        })

        suite('errors', () => {
            test('on service worker url already existing in build', async () => {
                const project = await createDank()
                project.writeConfig(`\
    import { createServiceWorker } from '@eighty4/dank'
    export default {
        pages: {
            '/': './dank.html',
        },
        serviceWorker: async ({website}) => await createServiceWorker({
            cacheKey: website.buildTag,
            files: Array.from(website.files),
        }),
    }
    `)
                await writeFile(project.path('public/sw.js'), '')
                try {
                    await project.build()
                    assert.fail()
                } catch {}
            })

            test('on service worker builder returning undefined', async () => {
                const project = await createDank()
                project.writeConfig(`\
    import { createServiceWorker } from '@eighty4/dank'
    export default {
        pages: {
            '/': './dank.html',
        },
        serviceWorker: async ({website}) => {},
    }
    `)
                await writeFile(project.path('public/sw.js'), '')
                try {
                    await project.build()
                    assert.fail()
                } catch {}
            })

            suite('on service worker build invalid', () => {
                const specs: Array<[string | undefined, string | undefined]> = [
                    [undefined, '/sw.js'],
                    ['', undefined],
                    ['', 'sw.js'],
                    ['', '/sw.ts'],
                ]
                specs.forEach(([content, url]) => {
                    test(`with content=\`${content}\` and url=\`${url}\``, async () => {
                        const project = await createDank()
                        project.writeConfig(`\
            import { createServiceWorker } from '@eighty4/dank'
            export default {
                pages: {
                    '/': './dank.html',
                },
                serviceWorker: async ({website}) => {
                    return {
                        outputs: [{
                            content: ${content ? `'${content}'` : 'undefined'},
                            url: ${url ? `'${url}'` : 'undefined'},
                        }],
                    }
                },
            }
            `)
                        try {
                            await project.build()
                            assert.fail()
                        } catch {}
                    })
                })
            })
        })
    })

    suite('dank serve', () => {
        test('does not serve service worker', async () => {
            const project = await createDank()
            project.writeConfig(`\
import { createServiceWorker } from '@eighty4/dank'
export default {
    pages: {
        '/': './dank.html',
    },
    serviceWorker: async ({website}) => await createServiceWorker({
        cacheKey: website.buildTag,
        files: Array.from(website.files),
    }),
}
`)
            const serving = await project.serve()
            await serving.start()
            serving.on('error', assert.fail)
            serving.on('exit', assert.fail)
            await serving.assertFetchStatus('/sw.js', 404)
            serving.shutdown()
        })
    })

    suite('dank serve --preview', () => {
        test('serves service worker and includes in manifest', async () => {
            const project = await createDank()
            project.writeConfig(`\
import { createServiceWorker } from '@eighty4/dank'
export default {
    pages: {
        '/': './dank.html',
    },
    serviceWorker: async ({website}) => await createServiceWorker({
        cacheKey: website.buildTag,
        files: Array.from(website.files),
    }),
}
`)
            const serving = await project.servePreview()
            await serving.start()
            serving.on('error', assert.fail)
            serving.on('exit', assert.fail)
            await serving.assertFetchStatus('/sw.js', 200)
            serving.shutdown()
            const manifest = await project.readManifest()
            assert.ok(manifest.files.includes('/sw.js'))
        })
    })

    suite('service_worker.ts', () => {
        test('builds service worker content with install caching data', async () => {
            const result = await createServiceWorker({
                bypassCache: {
                    hosts: ['https://api.github.com'],
                    paths: ['/api'],
                },
                cacheKey: 'install-cache-key',
                files: ['/settings'],
            })
            assert.equal(result.outputs[0].url, '/sw.js')
            assert.ok(
                result.outputs[0].content.includes('https://api.github.com'),
            )
            assert.ok(result.outputs[0].content.includes('/api'))
            assert.ok(result.outputs[0].content.includes('install-cache-key'))
            assert.ok(result.outputs[0].content.includes('/settings'))
        })
    })
})
