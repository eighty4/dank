import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { suite, test } from 'node:test'
import {
    createDank,
    DankCreated,
    readReplaceWrite,
    readTest,
} from './dank_project_testing.ts'

suite('`dank build`', () => {
    suite('succeeds', () => {
        suite('building website.json manifest', () => {
            test('is written to build dir', async () => {
                const project = await createDank()
                await project.build()
                const websiteJson = await readFile(
                    project.path('build/website.json'),
                    'utf8',
                )
                const website = JSON.parse(websiteJson)
                assert.ok('buildTag' in website)
                assert.ok('files' in website)
                assert.ok('pageUrls' in website)
                assert.ok(website.files.includes('/index.html'))
                assert.ok(website.pageUrls.includes('/'))
            })
        })
        test('rewriting hrefs', async () => {
            const project = await createDank()
            await project.build()
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'index.html'),
                    /<script src="\/dank-[A-Z\d]{8}\.js" type="module"><\/script>/,
                ),
                `js script not found in ${project.path('build', 'dist', 'index.html')}`,
            )
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'index.html'),
                    /<link rel="stylesheet" href="\/dank-[A-Z\d]{8}\.css">/,
                ),
                `css link not found in ${project.path('build', 'dist', 'index.html')}`,
            )
        })

        test('resolves page and bundles configured in child dir', async () => {
            const project = await createDank({
                pages: {
                    '/': './dank.html',
                    '/subdir': './subdir/dank.html',
                },
                files: {
                    'pages/subdir/dank.html': `\
<link rel="stylesheet" href="./dank.css"/>
<script src="./dank.ts" type="module"></script>
`,
                    'pages/subdir/dank.css': `body { background: red; }`,
                    'pages/subdir/dank.ts': `console.log(document.body.style.background)`,
                },
            })
            await project.build()
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'index.html'),
                    /<script src="\/dank-[A-Z\d]{8}\.js" type="module"><\/script>/,
                    /<link rel="stylesheet" href="\/dank-[A-Z\d]{8}\.css">/,
                ),
                `bundles not found in ${project.path('build', 'dist', 'index.html')}`,
            )
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'subdir', 'index.html'),
                    /<script src="\/subdir\/dank-[A-Z\d]{8}\.js" type="module"><\/script>/,
                    /<link rel="stylesheet" href="\/subdir\/dank-[A-Z\d]{8}\.css">/,
                ),
                `bundles not found in ${project.path('build', 'dist', 'subdir', 'index.html')}`,
            )
        })

        test('resolves bundle in parent dir', async () => {
            const project = await createDank({
                pages: {
                    '/': './dank.html',
                    '/subdir': './subdir/dank.html',
                },
                files: {
                    'pages/subdir/dank.html': DankCreated.html
                        .replace(/\.\/dank\.ts/, '../dank.ts')
                        .replace(/\.\/dank\.css/, '../dank.css'),
                },
            })
            await project.build()
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'subdir', 'index.html'),
                    /<script src="\/dank-[A-Z\d]{8}\.js" type="module"><\/script>/,
                ),
                `js script not found in ${project.path('build', 'dist', 'subdir', 'index.html')}`,
            )
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'subdir', 'index.html'),
                    /<link rel="stylesheet" href="\/dank-[A-Z\d]{8}\.css">/,
                ),
                `css link not found in ${project.path('build', 'dist', 'subdir', 'index.html')}`,
            )
        })

        test('copying public assets to build/dist', async () => {
            const project = await createDank()
            await project.build()
            assert.ok(
                await readTest(
                    project.path('build', 'dist', '.webmanifest'),
                    /"name": "Dank 'n Eggs"/,
                ),
            )
        })
    })

    suite('errors', () => {
        test('importing from parent dir of pages dir', async () => {
            const project = await createDank()
            await readReplaceWrite(
                project.path('pages', 'dank.html'),
                /\.\/dank\.ts/,
                '../dank.ts',
            )
            try {
                await project.build()
                assert.fail('build should have failed')
            } catch (e) {}
        })

        test('page does not exist', async () => {
            const project = await createDank()
            await rm(project.path('pages/dank.html'))
            try {
                await project.build()
                assert.fail('build should have failed')
            } catch (e) {}
        })
    })
})
