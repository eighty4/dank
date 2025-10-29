import assert from 'node:assert/strict'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import {
    createDank,
    dankBuild,
    readReplaceWrite,
    readTest,
} from '../dank_project_testing.ts'

test('html entrypoint rewrites hrefs', async () => {
    const testDir = await createDank()
    await dankBuild(testDir)
    assert.ok(
        await readTest(
            join(testDir, 'build', 'dist', 'index.html'),
            /<script src="\/dank-[A-Z\d]{8}\.js" type="module"><\/script>/,
        ),
        `js script not found in ${join(testDir, 'build', 'dist', 'index.html')}`,
    )
    assert.ok(
        await readTest(
            join(testDir, 'build', 'dist', 'index.html'),
            /<link rel="stylesheet" href="\/dank-[A-Z\d]{8}\.css">/,
        ),
        `css link not found in ${join(testDir, 'build', 'dist', 'index.html')}`,
    )
})

test('html entrypoint at subpath url', async () => {
    const testDir = await createDank()
    await mkdir(join(testDir, 'pages', 'subdir'))
    await Promise.all(
        ['html', 'ts', 'css'].map(ext =>
            copyFile(
                join(testDir, 'pages', `dank.${ext}`),
                join(testDir, 'pages', 'subdir', `dank.${ext}`),
            ),
        ),
    )
    await writeFile(
        join(testDir, 'dank.config.ts'),
        `\
import { defineConfig } from '@eighty4/dank'

export default defineConfig({
    pages: {
        '/': './dank.html',
        '/subdir': './subdir/dank.html',
    }
})
`,
    )
    await dankBuild(testDir)
    assert.ok(
        await readTest(
            join(testDir, 'build', 'dist', 'index.html'),
            /<script src="\/dank-[A-Z\d]{8}\.js" type="module"><\/script>/,
        ),
        `js script not found in ${join(testDir, 'build', 'dist', 'index.html')}`,
    )
    assert.ok(
        await readTest(
            join(testDir, 'build', 'dist', 'index.html'),
            /<link rel="stylesheet" href="\/dank-[A-Z\d]{8}\.css">/,
        ),
        `css link not found in ${join(testDir, 'build', 'dist', 'index.html')}`,
    )
    assert.ok(
        await readTest(
            join(testDir, 'build', 'dist', 'subdir', 'index.html'),
            /<script src="\/subdir\/dank-[A-Z\d]{8}\.js" type="module"><\/script>/,
        ),
        `js script not found in ${join(testDir, 'build', 'dist', 'subdir', 'index.html')}`,
    )
    assert.ok(
        await readTest(
            join(testDir, 'build', 'dist', 'subdir', 'index.html'),
            /<link rel="stylesheet" href="\/subdir\/dank-[A-Z\d]{8}\.css">/,
        ),
        `css link not found in ${join(testDir, 'build', 'dist', 'subdir', 'index.html')}`,
    )
})

test('html entrypoint imports from parent dir', async () => {
    const testDir = await createDank()
    await mkdir(join(testDir, 'pages', 'subdir'))
    await copyFile(
        join(testDir, 'pages', 'dank.html'),
        join(testDir, 'pages', 'subdir', 'dank.html'),
    )
    await readReplaceWrite(
        join(testDir, 'pages', 'subdir', 'dank.html'),
        /\.\/dank\.ts/,
        '../dank.ts',
    )
    await readReplaceWrite(
        join(testDir, 'pages', 'subdir', 'dank.html'),
        /\.\/dank\.css/,
        '../dank.css',
    )
    await writeFile(
        join(testDir, 'dank.config.ts'),
        `\
import { defineConfig } from '@eighty4/dank'

export default defineConfig({
    pages: {
        '/': './dank.html',
        '/subdir': './subdir/dank.html',
    }
})
`,
    )
    await dankBuild(testDir)
    assert.ok(
        await readTest(
            join(testDir, 'build', 'dist', 'subdir', 'index.html'),
            /<script src="\/dank-[A-Z\d]{8}\.js" type="module"><\/script>/,
        ),
        `js script not found in ${join(testDir, 'build', 'dist', 'subdir', 'index.html')}`,
    )
    assert.ok(
        await readTest(
            join(testDir, 'build', 'dist', 'subdir', 'index.html'),
            /<link rel="stylesheet" href="\/dank-[A-Z\d]{8}\.css">/,
        ),
        `css link not found in ${join(testDir, 'build', 'dist', 'subdir', 'index.html')}`,
    )
})

test('html entrypoint errors when importing from parent dir of pages dir', async () => {
    const testDir = await createDank()
    await readReplaceWrite(
        join(testDir, 'pages', 'dank.html'),
        /\.\/dank\.ts/,
        '../dank.ts',
    )
    try {
        await dankBuild(testDir)
        assert.fail('build should have failed')
    } catch (e) {}
})
