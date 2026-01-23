import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import {
    createDank,
    DankCreated,
    fetchPageHtml,
} from '../dank_project_testing.ts'

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
