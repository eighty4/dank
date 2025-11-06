import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import esbuild from 'esbuild'
import { testDir } from './dank_project_testing.ts'
import { workersPlugin } from '../lib/esbuild.ts'
import { type DankBuild } from '../lib/flags.ts'
import { BuildRegistry, type BuildManifest } from '../lib/metadata.ts'

test('worker plugin finds worker url in entrypoint', async () => {
    const dirs = await testDir()
    const build = { dirs } as DankBuild
    await writeFile(
        join(dirs.projectRootAbs, dirs.pages, 'mega-performant-ui-thread.ts'),
        `\
console.log('devtools ui innovation')
const w = new Worker('./computational-wizardry.ts')
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
        write: false,
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
    assert.ok(
        await readFile(
            join(
                dirs.projectRootAbs,
                dirs.pages,
                'mega-performant-ui-thread.ts',
            ),
            'utf8',
        ),
        `\
console.log('devtools ui innovation')
const w = new Worker('pages/computational-wizardry.js')
w.onerror = console.error
`,
    )
})

test.only('worker plugin rewrites at correct offset for multiple workers', async () => {
    const dirs = await testDir()
    const build = { dirs } as DankBuild
    await writeFile(
        join(dirs.projectRootAbs, dirs.pages, 'mega-performant-ui-thread.ts'),
        `\
console.log('devtools ui innovation')
const w1 = new Worker('./computational-wizardry.ts')
const w2 = new Worker('./data-orchestration.ts')
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
        write: false,
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
    assert.ok(
        await readFile(
            join(
                dirs.projectRootAbs,
                dirs.pages,
                'mega-performant-ui-thread.ts',
            ),
            'utf8',
        ),
        `\
console.log('devtools ui innovation')
const w1 = new Worker('pages/computational-wizardry.js')
const w2 = new Worker('pages/data-orchestration.js')
`,
    )
})

test('worker plugin resolves worker url from an entrypoint import', async () => {
    const dirs = await testDir()
    const build = { dirs } as DankBuild
    await writeFile(
        join(dirs.projectRootAbs, dirs.pages, 'mega-performant-ui-thread.ts'),
        `\
import './mega-performant-ui-code.ts'
`,
    )
    await writeFile(
        join(dirs.projectRootAbs, dirs.pages, 'mega-performant-ui-code.ts'),
        `\
console.log('devtools ui innovation')
const w = new Worker('./computational-wizardry.ts')
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
})

test('worker plugin resolves worker entrypoint via relative bundle import', async () => {
    const dirs = await testDir()
    const build = { dirs } as DankBuild
    await writeFile(
        join(dirs.projectRootAbs, dirs.pages, 'mega-performant-ui-thread.ts'),
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
const w = new Worker('./computational-wizardry.ts')
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
const w = 'w' // new Worker('./partial-line.ts')
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
