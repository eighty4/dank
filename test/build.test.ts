import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { type BuildResult } from 'esbuild'
import { createWorkerRegex, rewriteWorkerUrls } from '../lib/build.ts'
import { type DankBuild } from '../lib/flags.ts'
import { WebsiteRegistry } from '../lib/metadata.ts'
import { testDir } from './dank_project_testing.ts'

test('rewriteWorkerUrls', async () => {
    const dirs = await testDir()
    const build = { dirs } as DankBuild
    await mkdir(join(dirs.projectRootAbs, build.dirs.buildDist), {
        recursive: true,
    })
    await writeFile(
        join(
            dirs.projectRootAbs,
            build.dirs.buildDist,
            'mega-performant-ui-thread-A1B2C3D4.js',
        ),
        `\
const w = new Worker('/computational-wizardry.js')
`,
    )
    const registry = new WebsiteRegistry(build)
    const buildRegistry = registry.buildRegistry()
    buildRegistry.addWorker({
        clientScript: 'pages/mega-performant-ui-thread.ts',
        workerEntryPoint: 'pages/computational-wizardry.ts',
        workerUrl: './computational-wizardry.ts',
        workerUrlPlaceholder: '/computational-wizardry.js',
    })
    buildRegistry.completeBuild({
        metafile: {
            outputs: {
                'build/dist/mega-performant-ui-thread-A1B2C3D4.js': {
                    entryPoint: 'pages/mega-performant-ui-thread.ts',
                    inputs: {
                        'pages/mega-performant-ui-thread.ts': null,
                    },
                },
                'build/dist/computational-wizardry-D4C3B2A1.js': {
                    entryPoint: 'pages/computational-wizardry.ts',
                    inputs: {
                        'pages/computational-wizardry.ts': null,
                    },
                },
            },
        },
    } as unknown as BuildResult)

    await rewriteWorkerUrls(build, registry)
    const contents = await readFile(
        join(
            dirs.projectRootAbs,
            build.dirs.buildDist,
            'mega-performant-ui-thread-A1B2C3D4.js',
        ),
        'utf8',
    )
    const expectHref = `new Worker('/computational-wizardry-D4C3B2A1.js')`
    assert.ok(
        contents.includes(expectHref),
        `did not find \`${expectHref}\` in \`${contents}\``,
    )
})

test('createWorkerRegex matches Worker ctor', () => {
    const regex = createWorkerRegex('./computational-wizardry.ts')
    const script = `new Worker('./computational-wizardry.ts')`
    assert.ok(regex.test(script))
})

test('createWorkerRegex does global replace', () => {
    const regex = createWorkerRegex('./computational-wizardry.ts')
    const script = `new Worker('./computational-wizardry.ts')`
    const worker = './computational-wizardry-A1B2C3D4.js'
    assert.equal(
        [script, script, script].join(' ').replace(regex, worker),
        [worker, worker, worker].join(' '),
    )
})
