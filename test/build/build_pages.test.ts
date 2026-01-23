import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import {
    createDank,
    DankCreated,
    readReplaceWrite,
    readTest,
} from '../dank_project_testing.ts'

suite('building pages', () => {
    suite('succeeds', () => {
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
    })
})
