import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { suite, test } from 'node:test'
import esbuild, { type BuildResult } from 'esbuild'
import { createDank, testDir } from './dank_project_testing.ts'
import { createWorkerRegex, rewriteWorkerUrls } from '../lib/build.ts'
import { loadConfig } from '../lib/config.ts'
import { esbuildWebpages, workersPlugin } from '../lib/esbuild.ts'
import {
    BuildRegistry,
    type BuildManifest,
    WebsiteRegistry,
} from '../lib/registry.ts'

suite('Web workers', () => {
    suite('`dank build`', () => {
        test('rewriting worker url with build hash', async () => {
            for (const ctor of ['Worker', 'SharedWorker']) {
                const project = await createDank({
                    files: {
                        'pages/dank.ts': `\
                            const w = new ${ctor}('./computational-wizardry.ts')
                            w.onerror = console.error`,
                        'pages/computational-wizardry.ts': '',
                    },
                })
                await project.build()
                const output =
                    await project.readBundleOutputFromBuild('dank.ts')
                const pattern = new RegExp(
                    `new ${ctor}\\('\\/computational-wizardry-[A-Z\\d]{8}\\.js'\\)`,
                    'g',
                )
                assert.ok(pattern.test(output))
                assert.equal(
                    await project.readBundleOutputFromBuild(
                        'computational-wizardry.ts',
                    ),
                    '',
                )
            }
        })
    })
    suite('build.lib', () => {
        suite('rewriteWorkerUrls', () => {
            test('adds bundle content hash', async () => {
                for (const ctor of ['Worker', 'SharedWorker']) {
                    const { dirs } = await testDir()
                    await writeFile(
                        join(dirs.projectRootAbs, 'dank.config.ts'),
                        `export default { pages: { '/home': 'Home.html' } }`,
                    )
                    await writeFile(
                        join(dirs.projectRootAbs, 'pages', 'Home.html'),
                        ``,
                    )
                    await mkdir(join(dirs.projectRootAbs, dirs.buildDist), {
                        recursive: true,
                    })
                    await writeFile(
                        join(
                            dirs.projectRootAbs,
                            dirs.buildDist,
                            'mega-performant-ui-thread-A1B2C3D4.js',
                        ),
                        `const w = new ${ctor}('/computational-wizardry.js')`,
                    )
                    const c = await loadConfig('build', dirs.projectRootAbs)
                    const registry = new WebsiteRegistry(c)
                    const buildRegistry = registry.buildRegistry()
                    buildRegistry.addWorker({
                        clientScript: 'pages/mega-performant-ui-thread.ts',
                        workerCtor: ctor as 'Worker' | 'SharedWorker',
                        workerEntryPoint: 'pages/computational-wizardry.ts',
                        workerUrl: './computational-wizardry.ts',
                        workerUrlPlaceholder: '/computational-wizardry.js',
                    })
                    buildRegistry.completeBuild({
                        metafile: {
                            outputs: {
                                'build/dist/mega-performant-ui-thread-A1B2C3D4.js':
                                    {
                                        entryPoint:
                                            'pages/mega-performant-ui-thread.ts',
                                        inputs: {
                                            'pages/mega-performant-ui-thread.ts':
                                                null,
                                        },
                                    },
                                'build/dist/computational-wizardry-D4C3B2A1.js':
                                    {
                                        entryPoint:
                                            'pages/computational-wizardry.ts',
                                        inputs: {
                                            'pages/computational-wizardry.ts':
                                                null,
                                        },
                                    },
                            },
                        },
                    } as unknown as BuildResult)

                    await rewriteWorkerUrls(dirs, registry)
                    const contents = await readFile(
                        join(
                            dirs.projectRootAbs,
                            dirs.buildDist,
                            'mega-performant-ui-thread-A1B2C3D4.js',
                        ),
                        'utf8',
                    )
                    const expectHref = `new ${ctor}('/computational-wizardry-D4C3B2A1.js')`
                    assert.ok(
                        contents.includes(expectHref),
                        `did not find \`${expectHref}\` in \`${contents}\``,
                    )
                }
            })
        })

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
                for (const ctor of ['SharedWorker', 'Worker']) {
                    const { dirs, resolver } = await testDir({
                        files: {
                            'pages/mega-performant-ui-thread.ts': `\
console.log('devtools ui innovation')
const w = new ${ctor}('./computational-wizardry.ts')
w.onerror = console.error
`,
                        },
                    })
                    let result: BuildManifest | null = null
                    await esbuild.build({
                        absWorkingDir: dirs.projectRootAbs,
                        entryPoints: [
                            {
                                in: 'pages/mega-performant-ui-thread.ts',
                                out: 'mega-performant-ui-thread',
                            },
                        ],
                        metafile: true,
                        plugins: [
                            workersPlugin(
                                new BuildRegistry(
                                    dirs,
                                    resolver,
                                    _result => (result = _result),
                                ),
                            ),
                        ],
                        outdir: 'build',
                        write: true,
                    })
                    assert.deepEqual(result!.workers, [
                        {
                            clientScript: 'pages/mega-performant-ui-thread.ts',
                            dependentEntryPoint:
                                'pages/mega-performant-ui-thread.ts',
                            workerCtor: ctor,
                            workerEntryPoint: 'pages/computational-wizardry.ts',
                            workerUrl: './computational-wizardry.ts',
                            workerUrlPlaceholder: '/computational-wizardry.js',
                        },
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
const w = new ${ctor}("/computational-wizardry.js");
w.onerror = console.error;
`,
                    )
                }
            })

            test('finds worker url with opts arg in worker ctor', async () => {
                for (const ctor of ['SharedWorker', 'Worker']) {
                    const { dirs, resolver } = await testDir({
                        files: {
                            'pages/mega-performant-ui-thread.ts': `\
console.log('devtools ui innovation')
const w = new ${ctor}('./computational-wizardry.ts', { name: 'magellan' })
w.onerror = console.error
`,
                        },
                    })
                    let result: BuildManifest | null = null
                    await esbuild.build({
                        absWorkingDir: dirs.projectRootAbs,
                        entryPoints: [
                            {
                                in: 'pages/mega-performant-ui-thread.ts',
                                out: 'mega-performant-ui-thread',
                            },
                        ],
                        metafile: true,
                        plugins: [
                            workersPlugin(
                                new BuildRegistry(
                                    dirs,
                                    resolver,
                                    _result => (result = _result),
                                ),
                            ),
                        ],
                        outdir: 'build',
                        write: true,
                    })
                    assert.deepEqual(result!.workers, [
                        {
                            clientScript: 'pages/mega-performant-ui-thread.ts',
                            dependentEntryPoint:
                                'pages/mega-performant-ui-thread.ts',
                            workerCtor: ctor,
                            workerEntryPoint: 'pages/computational-wizardry.ts',
                            workerUrl: './computational-wizardry.ts',
                            workerUrlPlaceholder: '/computational-wizardry.js',
                        },
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
const w = new ${ctor}("/computational-wizardry.js", { name: "magellan" });
w.onerror = console.error;
`,
                    )
                }
            })

            test('rewrites at correct offset for multiple workers', async () => {
                for (const ctor of ['SharedWorker', 'Worker']) {
                    const { dirs, resolver } = await testDir({
                        files: {
                            'pages/mega-performant-ui-thread.ts': `\
console.log('devtools ui innovation')
const w1 = new ${ctor}('./computational-wizardry.ts')
const w2 = new ${ctor}('./data-orchestration.ts')
`,
                        },
                    })
                    let result: BuildManifest | null = null
                    await esbuild.build({
                        absWorkingDir: dirs.projectRootAbs,
                        entryPoints: [
                            {
                                in: 'pages/mega-performant-ui-thread.ts',
                                out: 'mega-performant-ui-thread',
                            },
                        ],
                        metafile: true,
                        plugins: [
                            workersPlugin(
                                new BuildRegistry(
                                    dirs,
                                    resolver,
                                    _result => (result = _result),
                                ),
                            ),
                        ],
                        outdir: 'build',
                        write: true,
                    })
                    assert.deepEqual(result!.workers, [
                        {
                            clientScript: 'pages/mega-performant-ui-thread.ts',
                            dependentEntryPoint:
                                'pages/mega-performant-ui-thread.ts',
                            workerCtor: ctor,
                            workerEntryPoint: 'pages/computational-wizardry.ts',
                            workerUrl: './computational-wizardry.ts',
                            workerUrlPlaceholder: '/computational-wizardry.js',
                        },
                        {
                            clientScript: 'pages/mega-performant-ui-thread.ts',
                            dependentEntryPoint:
                                'pages/mega-performant-ui-thread.ts',
                            workerCtor: ctor,
                            workerEntryPoint: 'pages/data-orchestration.ts',
                            workerUrl: './data-orchestration.ts',
                            workerUrlPlaceholder: '/data-orchestration.js',
                        },
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
const w1 = new ${ctor}("/computational-wizardry.js");
const w2 = new ${ctor}("/data-orchestration.js");
`,
                    )
                }
            })

            test('resolves worker url from an entrypoint import', async () => {
                for (const ctor of ['Worker', 'SharedWorker']) {
                    const { dirs, resolver } = await testDir({
                        files: {
                            'pages/mega-performant-ui-thread.ts': `import './mega-performant-ui-code.ts'`,
                            'pages/mega-performant-ui-code.ts': `\
console.log('devtools ui innovation')
const w = new ${ctor}('./computational-wizardry.ts')
w.onerror = console.error`,
                        },
                    })
                    let result: BuildManifest | null = null
                    await esbuild.build({
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
                        plugins: [
                            workersPlugin(
                                new BuildRegistry(
                                    dirs,
                                    resolver,
                                    _result => (result = _result),
                                ),
                            ),
                        ],
                        write: false,
                    })
                    assert.deepEqual(result!.workers, [
                        {
                            clientScript: 'pages/mega-performant-ui-code.ts',
                            dependentEntryPoint:
                                'pages/mega-performant-ui-thread.ts',
                            workerCtor: ctor,
                            workerEntryPoint: 'pages/computational-wizardry.ts',
                            workerUrl: './computational-wizardry.ts',
                            workerUrlPlaceholder: '/computational-wizardry.js',
                        },
                    ])
                }
            })

            test('resolves worker entrypoint via relative bundle import', async () => {
                for (const ctor of ['Worker', 'SharedWorker']) {
                    const { dirs, resolver } = await testDir({
                        files: {
                            'pages/mega-performant-ui-thread.ts': `import './lib/mega-performant-ui-code.ts'`,
                            'pages/lib/mega-performant-ui-code.ts': `\
console.log('devtools ui innovation')
const w = new ${ctor}('./computational-wizardry.ts')
w.onerror = console.error`,
                        },
                    })
                    let result: BuildManifest | null = null
                    await esbuild.build({
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
                        plugins: [
                            workersPlugin(
                                new BuildRegistry(
                                    dirs,
                                    resolver,
                                    _result => (result = _result),
                                ),
                            ),
                        ],
                        write: false,
                    })
                    assert.deepEqual(result!.workers, [
                        {
                            clientScript:
                                'pages/lib/mega-performant-ui-code.ts',
                            dependentEntryPoint:
                                'pages/mega-performant-ui-thread.ts',
                            workerCtor: ctor,
                            workerEntryPoint:
                                'pages/lib/computational-wizardry.ts',
                            workerUrl: './computational-wizardry.ts',
                            workerUrlPlaceholder:
                                '/lib/computational-wizardry.js',
                        },
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
                let result: BuildManifest | null = null
                await esbuild.build({
                    absWorkingDir: dirs.projectRootAbs,
                    bundle: true,
                    entryPoints: ['pages/mega-performant-ui-thread.ts'],
                    format: 'esm',
                    metafile: true,
                    plugins: [
                        workersPlugin(
                            new BuildRegistry(
                                dirs,
                                resolver,
                                _result => (result = _result),
                            ),
                        ),
                    ],
                    write: false,
                })
                assert.deepEqual(result!.workers, null)
            })
        })
    })
    suite('registry.ts', () => {
        suite('WebsiteRegistry', () => {
            test('registers worker manifest', async () => {
                for (const ctor of ['Worker', 'SharedWorker']) {
                    const project = await createDank({
                        files: {
                            'pages/mega-performant-ui-thread.ts': `\
            const w = new ${ctor}('./computational-wizardry.ts')
            w.onerror = console.error
            `,
                        },
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
                            out: 'computational-wizardry.js',
                        },
                    ])
                    assert.deepEqual(registry.workers, [
                        {
                            clientScript: 'pages/mega-performant-ui-thread.ts',
                            dependentEntryPoint:
                                'pages/mega-performant-ui-thread.ts',
                            workerCtor: ctor,
                            workerEntryPoint: 'pages/computational-wizardry.ts',
                            workerUrl: './computational-wizardry.ts',
                            workerUrlPlaceholder: '/computational-wizardry.js',
                        },
                    ])
                }
            })
        })
    })
})
