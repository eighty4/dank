import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { suite, test } from 'node:test'
import esbuild from 'esbuild'
import { createWorkerRegex } from '../lib/build.ts'
import { esbuildWebpages, workersPlugin } from '../lib/esbuild.ts'
import {
    WebsiteRegistry,
    WorkerBuildRegistry,
    type WorkerManifest,
} from '../lib/registry.ts'
import { createDank, testDir } from './dank_project_testing.ts'

suite('Web workers', () => {
    suite('`dank build`', () => {
        suite('rewriting worker url with build hash', () => {
            test('with path ctor arg only', async () => {
                for (const ctor of ['Worker', 'SharedWorker']) {
                    const project = await createDank({
                        files: {
                            'pages/dank.ts': `\
                                const w = new ${ctor}('./computational-wizardry.ts')
                                w.onerror = console.error`,
                            'pages/computational-wizardry.ts': '',
                        },
                    })
                    const result = await project.build()
                    result.assertSuccess()
                    await project.assertDistContent(
                        'dank.ts',
                        new RegExp(
                            `new ${ctor}\\('\\/\\.lib\\/pages\\/computational-wizardry-[A-Z\\d]{8}\\.js'\\)`,
                            'g',
                        ),
                    )
                    await project.assertDistExists(
                        '.lib/pages/computational-wizardry.ts',
                    )
                }
            })

            test('with path & opts ctor args', async () => {
                for (const ctor of ['Worker', 'SharedWorker']) {
                    const project = await createDank({
                        files: {
                            'pages/dank.ts': `\
                                const w = new ${ctor}('./computational-wizardry.ts', {
                                    name: 'fancy calc',
                                })
                                w.onerror = console.error`,
                            'pages/computational-wizardry.ts': '',
                        },
                    })
                    const result = await project.build()
                    result.assertSuccess()
                    await project.assertDistContent(
                        'dank.ts',
                        new RegExp(
                            `new ${ctor}\\('\\/\\.lib\\/pages\\/computational-wizardry-[A-Z\\d]{8}\\.js',`,
                            'g',
                        ),
                    )
                    await project.assertDistExists(
                        '.lib/pages/computational-wizardry.ts',
                    )
                }
            })
        })

        suite('errors', () => {
            test('unresolved worker ctor entrypoint', async () => {
                for (const ctor of ['Worker', 'SharedWorker']) {
                    const project = await createDank({
                        files: {
                            'pages/dank.ts': `new ${ctor}('./notworker.ts')`,
                        },
                    })
                    const result = await project.build()
                    result.assertFailed()
                    result.assertOutput(
                        `Could not find ${ctor} entrypoint "pages/notworker.ts"`,
                    )
                    result.assertOutput(
                        `The ${ctor} entrypoint was found in "pages/dank.ts":`,
                    )
                    result.assertOutput(
                        `pages/dank.ts:1:${'new ('.length + ctor.length}:`,
                    )
                }
            })
        })
    })
    suite('`dank serve`', () => {
        test('worker url placeholder matches esbuild context entrypoint', async () => {
            const project = await createDank({
                files: {
                    'pages/dank.ts': `const w = new Worker('./computational-wizardry.ts')`,
                    'pages/computational-wizardry.ts': '',
                },
            })
            using dankServing = await project.serve()
            dankServing.on('error', assert.fail)
            dankServing.on('exit', assert.fail)
            await dankServing.start()
            await dankServing.assertFetchStatus(
                '/.lib/pages/computational-wizardry.js',
                200,
            )
            await dankServing.assertFetchText(
                '/dank.js',
                `new Worker("/.lib/pages/computational-wizardry.js")`,
            )
        })
        test('worker url placeholder not whack', async () => {
            const project = await createDank({
                files: {
                    'pages/dank.ts': null,
                    'pages/dank.css': null,
                    'pages/dank.html': null,
                    'pages/feature/dank.ts': `import {start} from '../../workers/feature/startWorker.ts'; start()`,
                    'pages/feature/dank.html':
                        '<html><head><script src="./dank.ts"></script></head></html>',
                    'workers/feature/computational-wizardry.ts': '',
                    'workers/feature/startWorker.ts': `export const start = () => new Worker('./computational-wizardry.ts')`,
                },
                pages: {
                    '/feature': './feature/dank.html',
                },
            })
            using dankServing = await project.serve()
            dankServing.on('error', assert.fail)
            dankServing.on('exit', assert.fail)
            await dankServing.start()
            await dankServing.assertFetchStatus(
                '/.lib/workers/feature/computational-wizardry.js',
                200,
            )
            await dankServing.assertFetchText(
                '/feature/dank.js',
                `new Worker("/.lib/workers/feature/computational-wizardry.js")`,
            )
        })
    })
    suite('build.lib', () => {
        suite('createWorkerRegex', () => {
            test('matches Worker ctor', () => {
                const regex = createWorkerRegex(
                    'Worker',
                    './computational-wizardry.ts',
                )
                const script = `new Worker('./computational-wizardry.ts')`
                assert.ok(regex.test(script))
            })

            test('does not match other ctor', () => {
                assert.ok(
                    !createWorkerRegex('Worker', './computer.ts').test(
                        `new SharedWorker('./computational-wizardry.ts')`,
                    ),
                )
                assert.ok(
                    !createWorkerRegex('SharedWorker', './computer.ts').test(
                        `new Worker('./computational-wizardry.ts')`,
                    ),
                )
            })

            test('does global replace', () => {
                const regex = createWorkerRegex(
                    'Worker',
                    './computational-wizardry.ts',
                )
                const script = `new Worker('./computational-wizardry.ts')`
                const worker = './computational-wizardry-A1B2C3D4.js'
                assert.equal(
                    [script, script, script].join(' ').replace(regex, worker),
                    [worker, worker, worker].join(' '),
                )
            })
        })
    })
    suite('esbuild.ts', () => {
        suite('esbuild plugin worker detection', () => {
            test('finds worker url in worker ctor', async () => {
                for (const ctor of ['SharedWorker', 'Worker'] as const) {
                    const { dirs, resolver } = await testDir({
                        files: {
                            'pages/mega-performant-ui-thread.ts': `\
console.log('devtools ui innovation')
const w = new ${ctor}('./computational-wizardry.ts')
w.onerror = console.error
`,
                        },
                    })
                    const workerRegistry = new WorkerBuildRegistry(
                        dirs,
                        resolver,
                    )
                    const { metafile } = await esbuild.build({
                        absWorkingDir: dirs.projectRootAbs,
                        entryPoints: [
                            {
                                in: 'pages/mega-performant-ui-thread.ts',
                                out: 'mega-performant-ui-thread',
                            },
                        ],
                        metafile: true,
                        plugins: [workersPlugin(workerRegistry)],
                        outdir: 'build',
                        write: true,
                    })
                    assert.deepEqual(workerRegistry.resolveWorkers(metafile), [
                        {
                            clientEntrypoint:
                                'pages/mega-performant-ui-thread.ts',
                            clientScript: 'pages/mega-performant-ui-thread.ts',
                            ctor,
                            entrypoint: {
                                in: 'pages/computational-wizardry.ts',
                                out: '.lib/pages/computational-wizardry.js',
                            },
                            originalCtorSrc: './computational-wizardry.ts',
                            placeholderCtorSrc:
                                '/.lib/pages/computational-wizardry.js',
                        } satisfies WorkerManifest,
                    ])
                    assert.equal(
                        await readFile(
                            join(
                                dirs.projectRootAbs,
                                'build',
                                'mega-performant-ui-thread.js',
                            ),
                            'utf8',
                        ),
                        `\
console.log("devtools ui innovation");
const w = new ${ctor}("/.lib/pages/computational-wizardry.js");
w.onerror = console.error;
`,
                    )
                }
            })

            test('finds worker url with opts arg in worker ctor', async () => {
                for (const ctor of ['SharedWorker', 'Worker'] as const) {
                    const { dirs, resolver } = await testDir({
                        files: {
                            'pages/mega-performant-ui-thread.ts': `\
console.log('devtools ui innovation')
const w = new ${ctor}('./computational-wizardry.ts', { name: 'magellan' })
w.onerror = console.error
`,
                        },
                    })
                    const workerRegistry = new WorkerBuildRegistry(
                        dirs,
                        resolver,
                    )
                    const { metafile } = await esbuild.build({
                        absWorkingDir: dirs.projectRootAbs,
                        entryPoints: [
                            {
                                in: 'pages/mega-performant-ui-thread.ts',
                                out: 'mega-performant-ui-thread',
                            },
                        ],
                        metafile: true,
                        plugins: [workersPlugin(workerRegistry)],
                        outdir: 'build',
                        write: true,
                    })
                    assert.deepEqual(workerRegistry.resolveWorkers(metafile), [
                        {
                            clientEntrypoint:
                                'pages/mega-performant-ui-thread.ts',
                            clientScript: 'pages/mega-performant-ui-thread.ts',
                            ctor,
                            entrypoint: {
                                in: 'pages/computational-wizardry.ts',
                                out: '.lib/pages/computational-wizardry.js',
                            },
                            originalCtorSrc: './computational-wizardry.ts',
                            placeholderCtorSrc:
                                '/.lib/pages/computational-wizardry.js',
                        } satisfies WorkerManifest,
                    ])
                    assert.equal(
                        await readFile(
                            join(
                                dirs.projectRootAbs,
                                'build',
                                'mega-performant-ui-thread.js',
                            ),
                            'utf8',
                        ),
                        `\
console.log("devtools ui innovation");
const w = new ${ctor}("/.lib/pages/computational-wizardry.js", { name: "magellan" });
w.onerror = console.error;
`,
                    )
                }
            })

            test('rewrites at correct offset for multiple workers', async () => {
                for (const ctor of ['SharedWorker', 'Worker'] as const) {
                    const { dirs, resolver } = await testDir({
                        files: {
                            'pages/mega-performant-ui-thread.ts': `\
console.log('devtools ui innovation')
const w1 = new ${ctor}('./computational-wizardry.ts')
const w2 = new ${ctor}('./data-orchestration.ts')
`,
                        },
                    })
                    const workerRegistry = new WorkerBuildRegistry(
                        dirs,
                        resolver,
                    )
                    const { metafile } = await esbuild.build({
                        absWorkingDir: dirs.projectRootAbs,
                        entryPoints: [
                            {
                                in: 'pages/mega-performant-ui-thread.ts',
                                out: 'mega-performant-ui-thread',
                            },
                        ],
                        metafile: true,
                        plugins: [workersPlugin(workerRegistry)],
                        outdir: 'build',
                        write: true,
                    })
                    assert.deepEqual(workerRegistry.resolveWorkers(metafile), [
                        {
                            clientEntrypoint:
                                'pages/mega-performant-ui-thread.ts',
                            clientScript: 'pages/mega-performant-ui-thread.ts',
                            ctor,
                            entrypoint: {
                                in: 'pages/computational-wizardry.ts',
                                out: '.lib/pages/computational-wizardry.js',
                            },
                            originalCtorSrc: './computational-wizardry.ts',
                            placeholderCtorSrc:
                                '/.lib/pages/computational-wizardry.js',
                        } satisfies WorkerManifest,
                        {
                            clientEntrypoint:
                                'pages/mega-performant-ui-thread.ts',
                            clientScript: 'pages/mega-performant-ui-thread.ts',
                            ctor,
                            entrypoint: {
                                in: 'pages/data-orchestration.ts',
                                out: '.lib/pages/data-orchestration.js',
                            },
                            originalCtorSrc: './data-orchestration.ts',
                            placeholderCtorSrc:
                                '/.lib/pages/data-orchestration.js',
                        } satisfies WorkerManifest,
                    ])
                    assert.equal(
                        await readFile(
                            join(
                                dirs.projectRootAbs,
                                'build',
                                'mega-performant-ui-thread.js',
                            ),
                            'utf8',
                        ),
                        `\
console.log("devtools ui innovation");
const w1 = new ${ctor}("/.lib/pages/computational-wizardry.js");
const w2 = new ${ctor}("/.lib/pages/data-orchestration.js");
`,
                    )
                }
            })

            test('resolves worker url from an entrypoint import', async () => {
                for (const ctor of ['Worker', 'SharedWorker'] as const) {
                    const { dirs, resolver } = await testDir({
                        files: {
                            'pages/mega-performant-ui-thread.ts': `import './mega-performant-ui-code.ts'`,
                            'pages/mega-performant-ui-code.ts': `\
console.log('devtools ui innovation')
const w = new ${ctor}('./computational-wizardry.ts')
w.onerror = console.error`,
                        },
                    })
                    const workerRegistry = new WorkerBuildRegistry(
                        dirs,
                        resolver,
                    )
                    const { metafile } = await esbuild.build({
                        absWorkingDir: dirs.projectRootAbs,
                        bundle: true,
                        entryPoints: [
                            {
                                in: 'pages/mega-performant-ui-thread.ts',
                                out: 'mega-performant-ui-thread',
                            },
                        ],
                        format: 'esm',
                        metafile: true,
                        plugins: [workersPlugin(workerRegistry)],
                        write: false,
                    })
                    assert.deepEqual(workerRegistry.resolveWorkers(metafile), [
                        {
                            clientEntrypoint:
                                'pages/mega-performant-ui-thread.ts',
                            clientScript: 'pages/mega-performant-ui-code.ts',
                            ctor,
                            entrypoint: {
                                in: 'pages/computational-wizardry.ts',
                                out: '.lib/pages/computational-wizardry.js',
                            },
                            originalCtorSrc: './computational-wizardry.ts',
                            placeholderCtorSrc:
                                '/.lib/pages/computational-wizardry.js',
                        } satisfies WorkerManifest,
                    ])
                }
            })

            test('resolves worker entrypoint via relative bundle import', async () => {
                for (const ctor of ['Worker', 'SharedWorker'] as const) {
                    const { dirs, resolver } = await testDir({
                        files: {
                            'pages/mega-performant-ui-thread.ts': `import './lib/mega-performant-ui-code.ts'`,
                            'pages/lib/mega-performant-ui-code.ts': `\
console.log('devtools ui innovation')
const w = new ${ctor}('./computational-wizardry.ts')
w.onerror = console.error`,
                        },
                    })
                    const workerRegistry = new WorkerBuildRegistry(
                        dirs,
                        resolver,
                    )
                    const { metafile } = await esbuild.build({
                        absWorkingDir: dirs.projectRootAbs,
                        bundle: true,
                        entryPoints: [
                            {
                                in: 'pages/mega-performant-ui-thread.ts',
                                out: 'mega-performant-ui-thread',
                            },
                        ],
                        format: 'esm',
                        metafile: true,
                        plugins: [workersPlugin(workerRegistry)],
                        write: false,
                    })
                    assert.deepEqual(workerRegistry.resolveWorkers(metafile), [
                        {
                            clientScript:
                                'pages/lib/mega-performant-ui-code.ts',
                            clientEntrypoint:
                                'pages/mega-performant-ui-thread.ts',
                            ctor,
                            entrypoint: {
                                in: 'pages/lib/computational-wizardry.ts',
                                out: '.lib/pages/lib/computational-wizardry.js',
                            },
                            originalCtorSrc: './computational-wizardry.ts',
                            placeholderCtorSrc:
                                '/.lib/pages/lib/computational-wizardry.js',
                        } satisfies WorkerManifest,
                    ])
                }
            })

            test('ignores commented workers', async () => {
                const { dirs, resolver } = await testDir({
                    files: {
                        'pages/mega-performant-ui-thread.ts': `\
/*
* new Worker('./multi-line-block.ts')
*/
/* new Worker('./single-line-block.ts') */
// new Worker('./full-line.ts')
let w = 'w' // new Worker('./partial-line.ts')
/*
* new SharedWorker('./multi-line-block.ts')
*/
/* new SharedWorker('./single-line-block.ts') */
// new SharedWorker('./full-line.ts')
w = 'w' // new SharedWorker('./partial-line.ts')`,
                    },
                })
                const workerRegistry = new WorkerBuildRegistry(dirs, resolver)
                const { metafile } = await esbuild.build({
                    absWorkingDir: dirs.projectRootAbs,
                    bundle: true,
                    entryPoints: ['pages/mega-performant-ui-thread.ts'],
                    format: 'esm',
                    metafile: true,
                    plugins: [workersPlugin(workerRegistry)],
                    write: false,
                })
                assert.deepEqual(workerRegistry.resolveWorkers(metafile), null)
            })
        })
    })
    suite('registry.ts', () => {
        suite('WebsiteRegistry', () => {
            test('registers worker manifest', async () => {
                for (const ctor of ['Worker', 'SharedWorker'] as const) {
                    const project = await createDank({
                        files: {
                            'pages/mega-performant-ui-thread.ts': `\
            const w = new ${ctor}('./computational-wizardry.ts')
            w.onerror = console.error
            `,
                        },
                    })
                    await mkdir(project.path('build/metafiles'), {
                        recursive: true,
                    })
                    const registry = new WebsiteRegistry(
                        await project.loadConfig(),
                    )
                    let workersEvent = 0
                    registry.on('workers', () => workersEvent++)
                    const define = {
                        'dank.IS_DEV': 'true',
                        'dank.IS_PROD': 'false',
                    }
                    for (let i = 0; i < 5; i++) {
                        await esbuildWebpages(registry, define, [
                            {
                                in: 'pages/mega-performant-ui-thread.ts',
                                out: 'mega-performant-ui-thread.ts',
                            },
                        ])
                    }
                    assert.equal(workersEvent, 1)
                    assert.deepEqual(registry.workerEntryPoints, [
                        {
                            in: 'pages/computational-wizardry.ts',
                            out: '.lib/pages/computational-wizardry.js',
                        },
                    ])
                    assert.deepEqual(registry.workers, [
                        {
                            clientEntrypoint:
                                'pages/mega-performant-ui-thread.ts',
                            clientScript: 'pages/mega-performant-ui-thread.ts',
                            ctor,
                            entrypoint: {
                                in: 'pages/computational-wizardry.ts',
                                out: '.lib/pages/computational-wizardry.js',
                            },
                            originalCtorSrc: './computational-wizardry.ts',
                            placeholderCtorSrc:
                                '/.lib/pages/computational-wizardry.js',
                        } satisfies WorkerManifest,
                    ])
                }
            })
        })
    })
})
