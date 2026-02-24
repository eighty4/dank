import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import {
    createDank,
    DankCreated,
    fetchPageHtml,
    readTest,
} from './dank_project_testing.ts'

suite('HTML partials', () => {
    suite('`dank build`', () => {
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

            test('importing bad path', async () => {
                const project = await createDank({
                    files: {
                        'pages/dank.html': DankCreated.html.replace(
                            /<\/head>/,
                            `<!-- {{ bad_ext.jif }} -->\n</head>`,
                        ),
                    },
                })
                try {
                    await project.build()
                    assert.fail('build should have failed')
                } catch (e) {}
            })

            test('recursive partial', async () => {
                const project = await createDank({
                    files: {
                        'pages/dank.html': DankCreated.html.replace(
                            /<\/head>/,
                            `<!-- {{ partial.html }} -->\n</head>`,
                        ),
                        'pages/partial.html': `<p>Partial</p>\n<!-- {{ another_partial.html }} -->`,
                    },
                })
                try {
                    await project.build()
                    assert.fail('build should have failed')
                } catch (e) {}
            })
        })
    })

    suite('`dank serve`', () => {
        suite('serving partials', () => {
            test('add partial to webpage', async () => {
                const project = await createDank({
                    files: {
                        'pages/notification_ui.html':
                            '<link rel="stylesheet" href="./Notifications.css"/>\n<script type="module" src="./Notifications.ts"></script>',
                        'pages/Notifications.ts': `alert('notification')`,
                        'pages/Notifications.css': `dialog[open] { display: none; }`,
                    },
                })
                using dankServing = await project.serve()
                dankServing.on('error', assert.fail)
                dankServing.on('exit', assert.fail)
                await dankServing.start()
                await fetchPageHtml(dankServing.dankPort, '/', html => {
                    assert.ok(!html.includes('Notifications.css'))
                    assert.ok(!html.includes('Notifications.js'))
                })
                await project.update(
                    'pages/dank.html',
                    DankCreated.html.replace(
                        /<\/head>/,
                        `<!-- {{ ./notification_ui.html }} -->\n</head>`,
                    ),
                )
                await fetchPageHtml(dankServing.dankPort, '/', html => {
                    assert.ok(html.includes('Notifications.css'))
                    assert.ok(html.includes('Notifications.js'))
                })
            })

            test('remove partial from webpage', async () => {
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
                using dankServing = await project.serve()
                dankServing.on('error', assert.fail)
                dankServing.on('exit', assert.fail)
                await dankServing.start()
                await fetchPageHtml(dankServing.dankPort, '/', html => {
                    assert.ok(html.includes('Notifications.css'))
                    assert.ok(html.includes('Notifications.js'))
                })
                await project.update(
                    'pages/dank.html',
                    DankCreated.html.replace(
                        /<!-- {{ \.\/notification_ui\.html }} -->/,
                        ``,
                    ),
                )
                await fetchPageHtml(dankServing.dankPort, '/', html => {
                    assert.ok(!html.includes('Notifications.css'))
                    assert.ok(!html.includes('Notifications.js'))
                })
            })

            test('partial adds bundle to build ctx', async () => {
                const project = await createDank({
                    files: {
                        'pages/dank.html': DankCreated.html.replace(
                            /<\/head>/,
                            `<!-- {{ ./notification_ui.html }} -->\n</head>`,
                        ),
                        'pages/notification_ui.html': '',
                        'pages/Notifications.ts': `alert('notifications')`,
                        'pages/Notifications.css': `dialog[open] { display: none; }`,
                    },
                })
                using dankServing = await project.serve()
                dankServing.on('error', assert.fail)
                dankServing.on('exit', assert.fail)
                await dankServing.start()
                await fetchPageHtml(dankServing.dankPort, '/', html => {
                    assert.ok(!html.includes('Notifications.css'))
                    assert.ok(!html.includes('Notifications.js'))
                })
                await project.update(
                    'pages/notification_ui.html',
                    '<link rel="stylesheet" href="./Notifications.css"/>\n<script type="module" src="./Notifications.ts"></script>',
                )
                await fetchPageHtml(dankServing.dankPort, '/', html => {
                    assert.ok(html.includes('Notifications.css'))
                    assert.ok(html.includes('Notifications.js'))
                })
            })

            test('partial removes bundle from build ctx', async () => {
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
                using dankServing = await project.serve()
                dankServing.on('error', assert.fail)
                dankServing.on('exit', assert.fail)
                await dankServing.start()
                await fetchPageHtml(dankServing.dankPort, '/', html => {
                    assert.ok(html.includes('Notifications.css'))
                    assert.ok(html.includes('Notifications.js'))
                })
                await project.update('pages/notification_ui.html', '')
                await fetchPageHtml(dankServing.dankPort, '/', html => {
                    assert.ok(!html.includes('Notifications.css'))
                    assert.ok(!html.includes('Notifications.js'))
                })
            })
        })
    })
})
