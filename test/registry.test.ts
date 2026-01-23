import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import esbuild from 'esbuild'
import { createDank } from './dank_project_testing.ts'
import { workersPlugin } from '../lib/esbuild.ts'
import { WebsiteRegistry } from '../lib/registry.ts'

suite('registry.ts', () => {
    suite('website registry', () => {
        suite('build registry', () => {
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
                    for (let i = 0; i < 5; i++) {
                        await esbuild.build({
                            absWorkingDir: project.dir,
                            entryPoints: ['pages/mega-performant-ui-thread.ts'],
                            metafile: true,
                            plugins: [workersPlugin(registry.buildRegistry())],
                            write: false,
                        })
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
