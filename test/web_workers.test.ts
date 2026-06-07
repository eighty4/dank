import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import { createWorkerRegex } from '../lib/build.ts'
import { createDank } from './dank_project_testing.ts'

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

            test('registers client for each ctor in script', async () => {
                for (const ctor of ['Worker', 'SharedWorker']) {
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
                for (const ctor of ['Worker', 'SharedWorker']) {
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
                for (const ctor of ['SharedWorker', 'Worker'] as const) {
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
                        `new ${ctor}('/.lib/pages/computational-wizardry`,
                    )
                    await project.assertDistContent(
                        'dank.js',
                        `new ${ctor}('/.lib/pages/data-orchestration`,
                    )
                    await project.assertDistExists(
                        '.lib/pages/computational-wizardry.js',
                    )
                    await project.assertDistExists(
                        '.lib/pages/data-orchestration.js',
                    )
                }
            })
        })

        suite('errors', () => {
            suite('unresolved worker ctor entrypoint', () => {
                test('entrypoint with worker ctor', async () => {
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
                test('one module with two workers unresolved', async () => {
                    for (const ctor of ['Worker', 'SharedWorker']) {
                        if (ctor === 'SharedWorker') continue
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
})
