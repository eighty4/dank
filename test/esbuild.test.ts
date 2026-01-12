import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import esbuild from 'esbuild'
import { testDir } from './dank_project_testing.ts'
import { workersPlugin } from '../lib/esbuild.ts'
import { type DankBuild } from '../lib/flags.ts'
import { BuildRegistry, type BuildManifest } from '../lib/metadata.ts'

test('worker plugin finds worker url in worker ctor', async () => {
    for (const ctor of ['SharedWorker', 'Worker']) {
        const dirs = await testDir()
        const build = { dirs } as DankBuild
        await writeFile(
            join(
                dirs.projectRootAbs,
                dirs.pages,
                'mega-performant-ui-thread.ts',
            ),
            `\
console.log('devtools ui innovation')
const w = new ${ctor}('./computational-wizardry.ts')
w.onerror = console.error
`,
        )
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
                    new BuildRegistry(build, _result => (result = _result)),
                ),
            ],
            outdir: 'build',
            write: true,
        })
        assert.deepEqual(result!.workers, [
            {
                clientScript: 'pages/mega-performant-ui-thread.ts',
                dependentEntryPoint: 'pages/mega-performant-ui-thread.ts',
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

test('worker plugin finds worker url with opts arg in worker ctor', async () => {
    for (const ctor of ['SharedWorker', 'Worker']) {
        const dirs = await testDir()
        const build = { dirs } as DankBuild
        await writeFile(
            join(
                dirs.projectRootAbs,
                dirs.pages,
                'mega-performant-ui-thread.ts',
            ),
            `\
console.log('devtools ui innovation')
const w = new ${ctor}('./computational-wizardry.ts', { name: 'magellan' })
w.onerror = console.error
    `,
        )
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
                    new BuildRegistry(build, _result => (result = _result)),
                ),
            ],
            outdir: 'build',
            write: true,
        })
        assert.deepEqual(result!.workers, [
            {
                clientScript: 'pages/mega-performant-ui-thread.ts',
                dependentEntryPoint: 'pages/mega-performant-ui-thread.ts',
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

test('worker plugin rewrites at correct offset for multiple workers', async () => {
    for (const ctor of ['SharedWorker', 'Worker']) {
        const dirs = await testDir()
        const build = { dirs } as DankBuild
        await writeFile(
            join(
                dirs.projectRootAbs,
                dirs.pages,
                'mega-performant-ui-thread.ts',
            ),
            `\
console.log('devtools ui innovation')
const w1 = new ${ctor}('./computational-wizardry.ts')
const w2 = new ${ctor}('./data-orchestration.ts')
`,
        )
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
                    new BuildRegistry(build, _result => (result = _result)),
                ),
            ],
            outdir: 'build',
            write: true,
        })
        assert.deepEqual(result!.workers, [
            {
                clientScript: 'pages/mega-performant-ui-thread.ts',
                dependentEntryPoint: 'pages/mega-performant-ui-thread.ts',
                workerEntryPoint: 'pages/computational-wizardry.ts',
                workerUrl: './computational-wizardry.ts',
                workerUrlPlaceholder: '/computational-wizardry.js',
            },
            {
                clientScript: 'pages/mega-performant-ui-thread.ts',
                dependentEntryPoint: 'pages/mega-performant-ui-thread.ts',
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

test('worker plugin resolves worker url from an entrypoint import', async () => {
    for (const ctor of ['Worker', 'SharedWorker']) {
        const dirs = await testDir()
        const build = { dirs } as DankBuild
        await writeFile(
            join(
                dirs.projectRootAbs,
                dirs.pages,
                'mega-performant-ui-thread.ts',
            ),
            `\
    import './mega-performant-ui-code.ts'
    `,
        )
        await writeFile(
            join(dirs.projectRootAbs, dirs.pages, 'mega-performant-ui-code.ts'),
            `\
    console.log('devtools ui innovation')
    const w = new ${ctor}('./computational-wizardry.ts')
    w.onerror = console.error
    `,
        )
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
                    new BuildRegistry(build, _result => (result = _result)),
                ),
            ],
            write: false,
        })
        assert.deepEqual(result!.workers, [
            {
                clientScript: 'pages/mega-performant-ui-code.ts',
                dependentEntryPoint: 'pages/mega-performant-ui-thread.ts',
                workerEntryPoint: 'pages/computational-wizardry.ts',
                workerUrl: './computational-wizardry.ts',
                workerUrlPlaceholder: '/computational-wizardry.js',
            },
        ])
    }
})

test('worker plugin resolves worker entrypoint via relative bundle import', async () => {
    for (const ctor of ['Worker', 'SharedWorker']) {
        const dirs = await testDir()
        const build = { dirs } as DankBuild
        await writeFile(
            join(
                dirs.projectRootAbs,
                dirs.pages,
                'mega-performant-ui-thread.ts',
            ),
            `\
    import './lib/mega-performant-ui-code.ts'
    `,
        )
        await mkdir(join(dirs.projectRootAbs, dirs.pages, 'lib'))
        await writeFile(
            join(
                dirs.projectRootAbs,
                dirs.pages,
                'lib',
                'mega-performant-ui-code.ts',
            ),
            `\
    console.log('devtools ui innovation')
    const w = new ${ctor}('./computational-wizardry.ts')
    w.onerror = console.error
    `,
        )
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
                    new BuildRegistry(build, _result => (result = _result)),
                ),
            ],
            write: false,
        })
        assert.deepEqual(result!.workers, [
            {
                clientScript: 'pages/lib/mega-performant-ui-code.ts',
                dependentEntryPoint: 'pages/mega-performant-ui-thread.ts',
                workerEntryPoint: 'pages/lib/computational-wizardry.ts',
                workerUrl: './computational-wizardry.ts',
                workerUrlPlaceholder: '/lib/computational-wizardry.js',
            },
        ])
    }
})

test('worker plugin does not resolve commented workers', async () => {
    const dirs = await testDir()
    const build = { dirs } as DankBuild
    await writeFile(
        join(dirs.projectRootAbs, 'mega-performant-ui-thread.ts'),
        `\
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
w = 'w' // new SharedWorker('./partial-line.ts')
`,
    )
    let result: BuildManifest | null = null
    await esbuild.build({
        absWorkingDir: dirs.projectRootAbs,
        bundle: true,
        entryPoints: ['mega-performant-ui-thread.ts'],
        format: 'esm',
        metafile: true,
        plugins: [
            workersPlugin(
                new BuildRegistry(build, _result => (result = _result)),
            ),
        ],
        write: false,
    })
    assert.deepEqual(result!.workers, null)
})
