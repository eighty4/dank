import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { suite, test } from 'node:test'
import { createWorkerRegex } from '../lib/build.ts'
import { defaultProjectDirs, Resolver } from '../lib/dirs.ts'
import { parseWorkerCtors, workerOutPathOf } from '../lib/web_workers.ts'
import type { WorkerCtorRegistration } from '../lib/registry.ts'
import { createDank } from './dank_project_testing.ts'

const WORKER_CTORS = ['Worker', 'SharedWorker']

suite('Web workers', () => {
    suite('`dank build`', () => {
        test('ignores commented workers', async () => {
            const project = await createDank({
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
            const result = await project.build()
            result.assertSuccess()
            assert.deepEqual(await project.readBuildWorkersManifest(), [])
        })

        test('plugin does not load/parse node_modules contents', async () => {
            const project = await createDank({
                files: {
                    'pages/dank.ts': `import { benchmark } from 'subsidized-food'\nbenchmark()`,
                },
            })
            await mkdir(project.path('node_modules/subsidized-food'), {
                recursive: true,
            })
            await writeFile(
                project.path('node_modules/subsidized-food/package.json'),
                `{"exports": {".": "./code.mjs"}}`,
            )
            await writeFile(
                project.path('node_modules/subsidized-food/code.mjs'),
                'export const benchmark = () => new Worker(new URL("wtf://homey"))',
            )
            const result = await project.build()
            result.assertSuccess()
        })

        suite('rewriting worker url with build hash', () => {
            test('with path ctor arg only', async () => {
                for (const ctor of WORKER_CTORS) {
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
                            `new ${ctor}\\('\\/\\.lib\\/w\\/pages_computational-wizardry\\.classic-[A-Z\\d]{8}\\.js'\\)`,
                            'g',
                        ),
                    )
                    await project.assertDistExists(
                        '.lib/w/pages_computational-wizardry.classic.ts',
                    )
                }
            })

            test('with path & opts ctor args', async () => {
                for (const ctor of WORKER_CTORS) {
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
                            `new ${ctor}\\('\\/\\.lib\\/w\\/pages_computational-wizardry.classic-[A-Z\\d]{8}\\.js',`,
                            'g',
                        ),
                    )
                    await project.assertDistExists(
                        '.lib/w/pages_computational-wizardry.classic.ts',
                    )
                }
            })

            test('registers client for each ctor in script', async () => {
                for (const ctor of WORKER_CTORS) {
                    const project = await createDank({
                        files: {
                            'pages/dank.ts': `\
                                const w = new ${ctor}('./computational-wizardry.ts', {
                                    name: 'fancy calc',
                                })
                                console.log('lets do it again')
                                const w2 = new ${ctor}('./computational-wizardry.ts', {
                                    name: 'fancy calc',
                                })`,
                            'pages/computational-wizardry.ts': '',
                        },
                    })
                    const result = await project.build()
                    result.assertSuccess()
                    const workers = await project.readBuildWorkersManifest()
                    assert.equal(workers.length, 1)
                    assert.equal(workers[0].clients.length, 2)
                }
            })

            test('registers client for ctors in multiple scripts', async () => {
                for (const ctor of WORKER_CTORS) {
                    const project = await createDank({
                        files: {
                            'pages/dank.html': `\
                                <script src="./dank.ts"></script>
                                <script src="./codes/api.ts"></script>
                            `,
                            'pages/dank.ts': `\
                                const w = new ${ctor}('./codes/computational-wizardry.ts', {
                                    name: 'fancy calc',
                                })`,
                            'pages/codes/api.ts': `\
                                const w = new ${ctor}('./computational-wizardry.ts', {
                                    name: 'fancy calc',
                                })
                            `,
                            'pages/codes/computational-wizardry.ts': '',
                        },
                    })
                    const result = await project.build()
                    result.assertSuccess()
                    const workers = await project.readBuildWorkersManifest()
                    assert.equal(workers.length, 1)
                    assert.equal(workers[0].clients.length, 2)
                }
            })

            test('rewrites at correct offset for multiple workers', async () => {
                for (const ctor of WORKER_CTORS) {
                    const project = await createDank({
                        files: {
                            'pages/dank.ts': `\
console.log('devtools ui innovation')
new ${ctor}('./computational-wizardry.ts')
new ${ctor}('./data-orchestration.ts')`,
                            'pages/computational-wizardry.ts': '',
                            'pages/data-orchestration.ts': '',
                        },
                    })
                    const result = await project.build()
                    result.assertSuccess()
                    await project.assertDistContent(
                        'dank.js',
                        `new ${ctor}('/.lib/w/pages_computational-wizardry.classic`,
                    )
                    await project.assertDistContent(
                        'dank.js',
                        `new ${ctor}('/.lib/w/pages_data-orchestration.classic`,
                    )
                    await project.assertDistExists(
                        '.lib/w/pages_computational-wizardry.classic.js',
                    )
                    await project.assertDistExists(
                        '.lib/w/pages_data-orchestration.classic.js',
                    )
                }
            })
        })

        suite('module worker', () => {
            test('rebuilds with module worker and split code', async () => {
                for (const ctor of WORKER_CTORS) {
                    const project = await createDank({
                        files: {
                            'pages/dank.ts': `import {getMashUpCostume} from './api.ts'; console.log(getMashUpCostume()); new ${ctor}('./worker.ts', {type: 'module'})`,
                            'pages/api.ts': `export const getMashUpCostume = () => 'Natalie Portugal the Man'`,
                            'pages/worker.ts': `import {getMashUpCostume} from './api.ts'; console.log(await Promise.resolve(getMashUpCostume()))`,
                        },
                    })
                    const result = await project.build()
                    result.assertSuccess()
                    await project.assertDistExists('.lib/w/pages_worker.esm.js')
                    await project.assertDistExists('.lib/c/chunk.js')
                    await project.assertDistExists('dank.js')
                }
            })
            test('classic and module worker of same script', async () => {
                for (const ctor of WORKER_CTORS) {
                    const project = await createDank({
                        files: {
                            'pages/dank.ts': `\
import {getMashUpCostume} from './api.ts'
console.log(getMashUpCostume())
new ${ctor}('./worker.ts')
new ${ctor}('./worker.ts', {type: 'module'})
`,
                            'pages/api.ts': `export const getMashUpCostume = () => 'Natalie Portugal the Man'`,
                            'pages/worker.ts': `import {getMashUpCostume} from './api.ts'; console.log(getMashUpCostume())`,
                        },
                    })
                    const result = await project.build()
                    result.assertSuccess()
                    await project.assertDistExists(
                        '.lib/w/pages_worker.classic.js',
                    )
                    await project.assertDistExists(
                        '.lib/w/pages_worker.classic.js',
                    )
                    await project.assertDistExists('.lib/w/pages_worker.esm.js')
                    await project.assertDistExists('.lib/c/chunk.js')
                    await project.assertDistExists('dank.js')
                }
            })
            suite('recursive workers', () => {
                test('classic worker recursively builds classic worker', async () => {
                    for (const ctor of WORKER_CTORS) {
                        const project = await createDank({
                            files: {
                                'pages/dank.ts': `new ${ctor}('./w1.ts')`,
                                'pages/w1.ts': `new ${ctor}('./w2.ts')`,
                                'pages/w2.ts': `console.log('w2')`,
                            },
                        })
                        const result = await project.build()
                        result.assertSuccess()
                        await project.assertDistExists(
                            '.lib/w/pages_w1.classic.js',
                        )
                        await project.assertDistExists(
                            '.lib/w/pages_w2.classic.js',
                        )
                        await project.assertDistExists('dank.js')
                    }
                })
                test('module worker recursively builds module worker', async () => {
                    for (const ctor of WORKER_CTORS) {
                        const project = await createDank({
                            files: {
                                'pages/dank.ts': `new ${ctor}('./w1.ts', {type: 'module'})`,
                                'pages/w1.ts': `new ${ctor}('./w2.ts', {type: 'module'})`,
                                'pages/w2.ts': `console.log('w2')`,
                            },
                        })
                        const result = await project.build()
                        result.assertSuccess()
                        await project.assertDistExists('.lib/w/pages_w1.esm.js')
                        await project.assertDistExists('.lib/w/pages_w2.esm.js')
                        await project.assertDistExists('dank.js')
                    }
                })
                test('classic worker recursively builds module worker', async () => {
                    for (const ctor of WORKER_CTORS) {
                        const project = await createDank({
                            files: {
                                'pages/dank.ts': `new ${ctor}('./w1.ts')`,
                                'pages/w1.ts': `new ${ctor}('./w2.ts', {type: 'module'})`,
                                'pages/w2.ts': `console.log('w2')`,
                            },
                        })
                        const result = await project.build()
                        result.assertSuccess()
                        await project.assertDistExists(
                            '.lib/w/pages_w1.classic.js',
                        )
                        await project.assertDistExists('.lib/w/pages_w2.esm.js')
                        await project.assertDistExists('dank.js')
                    }
                })
                test('module worker recursively builds classic worker', async () => {
                    for (const ctor of WORKER_CTORS) {
                        const project = await createDank({
                            files: {
                                'pages/dank.ts': `new ${ctor}('./w1.ts', {type: 'module'})`,
                                'pages/w1.ts': `new ${ctor}('./w2.ts')`,
                                'pages/w2.ts': `console.log('w2')`,
                            },
                        })
                        const result = await project.build()
                        result.assertSuccess()
                        await project.assertDistExists('.lib/w/pages_w1.esm.js')
                        await project.assertDistExists(
                            '.lib/w/pages_w2.classic.js',
                        )
                        await project.assertDistExists('dank.js')
                    }
                })
            })
        })

        suite('errors', () => {
            suite('unsupported code for iife output', () => {
                test('top-level await', async () => {
                    for (const ctor of WORKER_CTORS) {
                        const project = await createDank({
                            files: {
                                'pages/dank.ts': `new ${ctor}('./esm-tla.ts')`,
                                'pages/esm-tla.ts': `await Promise.resolve('modern feature')`,
                            },
                        })
                        const result = await project.build()
                        result.assertFailed()
                        result.assertOrderedOutput(
                            `Top-level await is not supported with the "iife" output format used to bundle classic web workers`,
                            'pages/esm-tla.ts:1:0:',
                            `1 │ await Promise.resolve('modern feature')`,
                            `Upgrade to module workers for your ${ctor} in "pages/dank.ts" with \`new ${ctor}('./esm-tla.ts', {type: 'module'})\``,
                            `1 │ new ${ctor}('./esm-tla.ts')`,
                        )
                    }
                })
            })
            suite('unresolved worker ctor entrypoint', () => {
                test('entrypoint with worker ctor', async () => {
                    for (const ctor of WORKER_CTORS) {
                        const project = await createDank({
                            files: {
                                'pages/dank.ts': `new ${ctor}('./notworker.ts')`,
                            },
                        })
                        const result = await project.build()
                        result.assertFailed()
                        result.assertOrderedOutput(
                            `Could not find ${ctor} entrypoint "pages/notworker.ts"`,
                            `The ${ctor} entrypoint was found in "pages/dank.ts":`,
                            `pages/dank.ts:1:${'new ('.length + ctor.length}:`,
                        )
                    }
                })
                test('one module with two workers unresolved', async () => {
                    for (const ctor of WORKER_CTORS) {
                        const project = await createDank({
                            files: {
                                'pages/dank.ts': `new ${ctor}('./notworker.ts')\nnew ${ctor}('./andmeneither.ts')`,
                            },
                        })
                        const result = await project.build()
                        result.assertFailed()
                        result.assertOrderedOutput(
                            `Could not find ${ctor} entrypoint "pages/andmeneither.ts"`,
                            `The ${ctor} entrypoint was found in "pages/dank.ts":`,
                            `pages/dank.ts:1:${'new ('.length + ctor.length}:`,
                            `1 │ new ${ctor}('./andmeneither.ts')`,
                        )
                        result.assertOrderedOutput(
                            `Could not find ${ctor} entrypoint "pages/notworker.ts"`,
                            `The ${ctor} entrypoint was found in "pages/dank.ts":`,
                            `pages/dank.ts:1:${'new ('.length + ctor.length}:`,
                            `1 │ new ${ctor}('./notworker.ts')`,
                        )
                    }
                })
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
                '/.lib/w/pages_computational-wizardry.classic.js',
                null,
                200,
            )
            await dankServing.assertFetchText(
                '/dank.js',
                null,
                `new Worker("/.lib/w/pages_computational-wizardry.classic.js")`,
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
                '/.lib/w/workers_feature_computational-wizardry.classic.js',
                null,
                200,
            )
            await dankServing.assertFetchText(
                '/feature/dank.js',
                null,
                `new Worker("/.lib/w/workers_feature_computational-wizardry.classic.js")`,
            )
        })
        test('with module worker', async () => {
            const project = await createDank({
                files: {
                    'pages/dank.ts': `new Worker('./w.ts', {type: 'module'})`,
                    'pages/w.ts': '',
                },
            })
            using dankServing = await project.serve()
            dankServing.on('error', assert.fail)
            dankServing.on('exit', assert.fail)
            await dankServing.start()
            await dankServing.assertFetchStatus(
                '/.lib/w/pages_w.esm.js',
                null,
                200,
            )
        })
        test('with classic and module builds of same worker', async () => {
            const project = await createDank({
                files: {
                    'pages/dank.ts': `new Worker('./w.ts'); new Worker('./w.ts', {type: 'module'})`,
                    'pages/w.ts': '',
                },
            })
            using dankServing = await project.serve()
            dankServing.on('error', assert.fail)
            dankServing.on('exit', assert.fail)
            await dankServing.start()
            await dankServing.assertFetchStatus(
                '/.lib/w/pages_w.classic.js',
                null,
                200,
            )
            await dankServing.assertFetchStatus(
                '/.lib/w/pages_w.esm.js',
                null,
                200,
            )
        })
        test('with recursive worker', async () => {
            const project = await createDank({
                files: {
                    'pages/dank.ts': `new Worker('./w1.ts')`,
                    'pages/w1.ts': `new Worker('./w2.ts', {type: 'module'})`,
                    'pages/w2.ts': '',
                },
            })
            using dankServing = await project.serve()
            dankServing.on('error', assert.fail)
            dankServing.on('exit', assert.fail)
            await dankServing.start()
            await dankServing.assertFetchStatus(
                '/.lib/w/pages_w1.classic.js',
                null,
                200,
            )
            await dankServing.assertFetchStatus(
                '/.lib/w/pages_w2.esm.js',
                null,
                200,
            )
        })
    })
    suite('lib build.ts', () => {
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

    suite('lib web_workers.ts', () => {
        suite('parseWorkerCtors', () => {
            test('resolves module worker', async () => {
                const resolver = Resolver.create(
                    await defaultProjectDirs(import.meta.dirname),
                )
                const js = `new Worker('./w.ts', {type: 'module'})\nconsole.log('created a worker!')`
                const parseResult = parseWorkerCtors(
                    join(import.meta.dirname, 'pages/webpage.ts'),
                    js,
                    resolver,
                )
                assert.ok(!parseResult.errors?.length)
                assert.deepEqual(parseResult.workers, [
                    {
                        clientScript: 'pages/webpage.ts',
                        ctor: 'Worker',
                        entrypointIn: 'pages/w.ts',
                        entrypointOut: '.lib/w/pages_w.esm.js',
                        originalCtorSrc: './w.ts',
                        placeholderCtorSrc: '/.lib/w/pages_w.esm.js',
                        workerType: 'module',
                    } satisfies WorkerCtorRegistration,
                ])
            })

            test('resolves named module worker', async () => {
                const resolver = Resolver.create(
                    await defaultProjectDirs(import.meta.dirname),
                )
                const js = `new Worker('./w.ts', {name: 'W', type: 'module'})\nconsole.log('created a worker!')`
                const parseResult = parseWorkerCtors(
                    join(import.meta.dirname, 'pages/webpage.ts'),
                    js,
                    resolver,
                )
                assert.ok(!parseResult.errors?.length)
                assert.deepEqual(parseResult.workers, [
                    {
                        clientScript: 'pages/webpage.ts',
                        ctor: 'Worker',
                        entrypointIn: 'pages/w.ts',
                        entrypointOut: '.lib/w/pages_w.esm.js',
                        originalCtorSrc: './w.ts',
                        placeholderCtorSrc: '/.lib/w/pages_w.esm.js',
                        workerType: 'module',
                    } satisfies WorkerCtorRegistration,
                ])
            })
        })
        suite('workerOutPathOf', () => {
            test('resolves module and classic out paths', () => {
                assert.equal(
                    '.lib/w/pages_settings_sync.esm.js',
                    workerOutPathOf('pages/settings/sync.ts', 'module'),
                )
                assert.equal(
                    '.lib/w/pages_settings_sync.classic.js',
                    workerOutPathOf('pages/settings/sync.ts', 'classic'),
                )
            })
        })
    })
})
