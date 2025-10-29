import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import {
    createDank,
    dankBuild,
    readReplaceWrite,
    readTest,
} from '../dank_project_testing.ts'

test('partial with html content', async () => {
    const testDir = await createDank()
    await readReplaceWrite(
        join(testDir, 'pages', 'dank.html'),
        /<\/head>/,
        `<!-- {{ ./open_graph.html }} -->\n</head>`,
    )
    await writeFile(
        join(testDir, 'pages', 'open_graph.html'),
        '<meta property="og:title" content="Sweet blog post, bro">',
    )
    await dankBuild(testDir)
    assert.ok(
        await readTest(
            join(testDir, 'build', 'dist', 'index.html'),
            /<meta property="og:title"/,
        ),
    )
})

test('partial with js and css entrypoints', async () => {
    const testDir = await createDank()
    await readReplaceWrite(
        join(testDir, 'pages', 'dank.html'),
        /<\/head>/,
        `<!-- {{ ./notification_ui.html }} -->\n</head>`,
    )
    await writeFile(
        join(testDir, 'pages', 'notification_ui.html'),
        '<link rel="stylesheet" href="./Notifications.css"/>\n<script type="module" src="./Notifications.ts"></script>',
    )
    await writeFile(
        join(testDir, 'pages', 'Notifications.ts'),
        `alert('notification')`,
    )
    await writeFile(
        join(testDir, 'pages', 'Notifications.css'),
        `dialog[open] { display: none; }`,
    )
    await dankBuild(testDir)
    assert.ok(
        await readTest(
            join(testDir, 'build', 'dist', 'index.html'),
            /<script type="module" src="\/Notifications-[A-Z\d]{8}\.js"><\/script>/,
        ),
        `js script not found in ${join(testDir, 'build', 'dist', 'index.html')}`,
    )
    assert.ok(
        await readTest(
            join(testDir, 'build', 'dist', 'index.html'),
            /<link rel="stylesheet" href="\/Notifications-[A-Z\d]{8}\.css">/,
        ),
        `css link not found in ${join(testDir, 'build', 'dist', 'index.html')}`,
    )
})

test('partial errors when importing from parent dir of pages dir', async () => {
    const testDir = await createDank()
    await readReplaceWrite(
        join(testDir, 'pages', 'dank.html'),
        /<\/head>/,
        `<!-- {{ ../bad_path.html }} -->\n</head>`,
    )
    try {
        await dankBuild(testDir)
        assert.fail('build should have failed')
    } catch (e) {}
})

test('partial errors when importing with absolute path', async () => {
    const testDir = await createDank()
    await readReplaceWrite(
        join(testDir, 'pages', 'dank.html'),
        /<\/head>/,
        `<!-- {{ /codes/bad_path.html }} -->\n</head>`,
    )
    try {
        await dankBuild(testDir)
        assert.fail('build should have failed')
    } catch (e) {}
})

test('partial in diff dir', async () => {
    const testDir = await createDank()
    await readReplaceWrite(
        join(testDir, 'pages', 'dank.html'),
        /<\/head>/,
        `<!-- {{ ./notifications/ui.html }} -->\n</head>`,
    )
    await mkdir(join(testDir, 'pages', 'notifications'))
    await writeFile(
        join(testDir, 'pages', 'notifications', 'ui.html'),
        '<link rel="stylesheet" href="./Notifications.css"/>\n<script type="module" src="./Notifications.ts"></script>',
    )
    await writeFile(
        join(testDir, 'pages', 'notifications', 'Notifications.ts'),
        `alert('notification')`,
    )
    await writeFile(
        join(testDir, 'pages', 'notifications', 'Notifications.css'),
        `dialog[open] { display: none; }`,
    )
    await dankBuild(testDir)
})
