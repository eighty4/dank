import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { suite, test } from 'node:test'
import { type BuildResult } from 'esbuild'
import { testDir } from './dank_project_testing.ts'
import { createWorkerRegex, rewriteWorkerUrls } from '../lib/build.ts'
import { loadConfig } from '../lib/config.ts'
import { WebsiteRegistry } from '../lib/registry.ts'

suite('build.lib', () => {
    suite('web worker util', () => {
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
})
