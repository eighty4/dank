import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import { createDank, DankCreated, readTest } from '../dank_project_testing.ts'

suite('building pages with partials', () => {
    suite('succeeds', () => {
        test('injects html content', async () => {
            const project = await createDank({
                files: {
                    'pages/dank.html': DankCreated.html.replace(
                        /<\/head>/,
                        `<!-- {{ ./open_graph.html }} -->\n</head>`,
                    ),
                    'pages/open_graph.html':
                        '<meta property="og:title" content="Sweet blog post, bro">',
                },
            })
            await project.build()
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'index.html'),
                    /<meta property="og:title"/,
                ),
            )
        })

        test('adds js and css entrypoints to webpage bundles', async () => {
            const project = await createDank({
                files: {
                    'pages/dank.html': DankCreated.html.replace(
                        /<\/head>/,
                        `<!-- {{ ./notification_ui.html }} -->\n</head>`,
                    ),
                    'pages/notification_ui.html':
                        '<link rel="stylesheet" href="./Notifications.css"/>\n<script type="module" src="./Notifications.ts"></script>',
                    'pages/Notifications.ts': `alert('notification')`,
                    'pages/Notifications.css': `dialog[open] { display: none; }`,
                },
            })
            await project.build()
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'index.html'),
                    /<script type="module" src="\/Notifications-[A-Z\d]{8}\.js"><\/script>/,
                ),
                `js script not found in ${project.path('build', 'dist', 'index.html')}`,
            )
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'index.html'),
                    /<link rel="stylesheet" href="\/Notifications-[A-Z\d]{8}\.css">/,
                ),
                `css link not found in ${project.path('build', 'dist', 'index.html')}`,
            )
        })

        test('resolves partial in child dir', async () => {
            const project = await createDank({
                files: {
                    'pages/dank.html': DankCreated.html.replace(
                        /<\/head>/,
                        `<!-- {{ ./notifications/ui.html }} -->\n</head>`,
                    ),
                    'pages/notifications/ui.html':
                        '<link rel="stylesheet" href="./Notifications.css"/>\n<script type="module" src="./Notifications.ts"></script>',
                    'pages/notifications/Notifications.ts': `alert('notification')`,
                    'pages/notifications/Notifications.css': `dialog[open] { display: none; }`,
                },
            })
            await project.build()
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'index.html'),
                    /<script type="module" src="\/notifications\/Notifications-[A-Z\d]{8}\.js"><\/script>/,
                ),
                `js script not found in ${project.path('build', 'dist', 'index.html')}`,
            )
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'index.html'),
                    /<link rel="stylesheet" href="\/notifications\/Notifications-[A-Z\d]{8}\.css">/,
                ),
                `css link not found in ${project.path('build', 'dist', 'index.html')}`,
            )
        })
    })

    suite('errors', () => {
        test('importing from parent dir of pages dir', async () => {
            const project = await createDank({
                files: {
                    'pages/dank.html': DankCreated.html.replace(
                        /<\/head>/,
                        `<!-- {{ ../bad_path.html }} -->\n</head>`,
                    ),
                },
            })
            try {
                await project.build()
                assert.fail('build should have failed')
            } catch (e) {}
        })

        test('importing with absolute path', async () => {
            const project = await createDank({
                files: {
                    'pages/dank.html': DankCreated.html.replace(
                        /<\/head>/,
                        `<!-- {{ /codes/bad_path.html }} -->\n</head>`,
                    ),
                },
            })
            try {
                await project.build()
                assert.fail('build should have failed')
            } catch (e) {}
        })
    })
})
