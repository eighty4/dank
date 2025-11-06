import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import {
    createDank,
    dankServe,
    fetchPageHtml,
    readReplaceWrite,
} from '../dank_project_testing.ts'
import { EsbuildEvents } from '../esbuild_events_testing.ts'

test.skip('partial added to html entrypoint', async () => {
    const testDir = await createDank()
    using dankServing = await dankServe(testDir)
    dankServing.on('error', assert.fail)
    dankServing.on('exit', assert.fail)
    await dankServing.start()
    using esbuildEvents = new EsbuildEvents(dankServing.esbuildPort)
    await fetchPageHtml(dankServing.dankPort, '/', html => {
        assert.ok(!html.includes('Notifications.css'))
        assert.ok(!html.includes('Notifications.js'))
    })
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
    await readReplaceWrite(
        join(testDir, 'pages', 'dank.html'),
        /<\/head>/,
        `<!-- {{ ./notification_ui.html }} -->\n</head>`,
    )
    await writeFile(
        join(testDir, 'pages', 'Notifications.ts'),
        `document.querySelector('dialog').open = true`,
    )
    assert.deepEqual((await esbuildEvents.nextEvent()).added.toSorted(), [
        '/Notifications.css',
        '/Notifications.js',
        '/dank.css',
        '/dank.js',
    ])
    await writeFile(join(testDir, 'pages', 'Notifications.css'), ``)
    assert.deepEqual((await esbuildEvents.nextEvent()).updated.toSorted(), [
        '/Notifications.css',
    ])
    await fetchPageHtml(dankServing.dankPort, '/', html => {
        assert.ok(html.includes('Notifications.css'))
        assert.ok(html.includes('Notifications.js'))
    })
})

test('partial removed from html entrypoint', async () => {
    const testDir = await createDank()
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
    await readReplaceWrite(
        join(testDir, 'pages', 'dank.html'),
        /<\/head>/,
        `<!-- {{ ./notification_ui.html }} -->\n</head>`,
    )
    using dankServing = await dankServe(testDir)
    dankServing.on('error', assert.fail)
    dankServing.on('exit', assert.fail)
    await dankServing.start()
    await fetchPageHtml(dankServing.dankPort, '/', html => {
        assert.ok(html.includes('Notifications.css'))
        assert.ok(html.includes('Notifications.js'))
    })

    await readReplaceWrite(
        join(testDir, 'pages', 'dank.html'),
        /<!-- {{ \.\/notification_ui\.html }} -->/,
        ``,
    )
    await new Promise(res => setTimeout(res, 500))

    await fetchPageHtml(dankServing.dankPort, '/', html => {
        assert.ok(!html.includes('Notifications.css'))
        assert.ok(!html.includes('Notifications.js'))
    })
})

test.skip('partial entrypoint added to build context', async () => {
    const testDir = await createDank()
    await writeFile(join(testDir, 'pages', 'notification_ui.html'), '')
    await writeFile(
        join(testDir, 'pages', 'Notifications.ts'),
        `alert('notification')`,
    )
    await writeFile(
        join(testDir, 'pages', 'Notifications.css'),
        `dialog[open] { display: none; }`,
    )
    await readReplaceWrite(
        join(testDir, 'pages', 'dank.html'),
        /<\/head>/,
        `<!-- {{ ./notification_ui.html }} -->\n</head>`,
    )
    using dankServing = await dankServe(testDir)
    dankServing.on('error', assert.fail)
    dankServing.on('exit', assert.fail)
    await dankServing.start()
    using esbuildEvents = new EsbuildEvents(dankServing.esbuildPort)
    await fetchPageHtml(dankServing.dankPort, '/', html => {
        assert.ok(!html.includes('Notifications.css'))
        assert.ok(!html.includes('Notifications.js'))
    })
    await writeFile(
        join(testDir, 'pages', 'notification_ui.html'),
        '<link rel="stylesheet" href="./Notifications.css"/>\n<script type="module" src="./Notifications.ts"></script>',
    )
    await fetchPageHtml(dankServing.dankPort, '/', html => {
        assert.ok(html.includes('Notifications.css'))
        assert.ok(html.includes('Notifications.js'))
    })
    await writeFile(
        join(testDir, 'pages', 'Notifications.ts'),
        `document.querySelector('dialog').open = true`,
    )
    assert.deepEqual((await esbuildEvents.nextEvent()).added.toSorted(), [
        '/Notifications.css',
        '/Notifications.js',
        '/dank.css',
        '/dank.js',
    ])
    await writeFile(join(testDir, 'pages', 'Notifications.css'), ``)
    assert.deepEqual((await esbuildEvents.nextEvent()).updated.toSorted(), [
        '/Notifications.css',
    ])
})

test.skip('partial entrypoint removed from build context', async () => {
    const testDir = await createDank()
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
    await readReplaceWrite(
        join(testDir, 'pages', 'dank.html'),
        /<\/head>/,
        `<!-- {{ ./notification_ui.html }} -->\n</head>`,
    )
    using dankServing = await dankServe(testDir)
    dankServing.on('error', assert.fail)
    dankServing.on('exit', assert.fail)
    await dankServing.start()
    await fetchPageHtml(dankServing.dankPort, '/', html => {
        assert.ok(html.includes('Notifications.css'))
        assert.ok(html.includes('Notifications.js'))
    })
    await writeFile(join(testDir, 'pages', 'notification_ui.html'), '')
    // wait to connect to esbuild context because of restart
    await new Promise(res => setTimeout(res, 1000))
    await fetchPageHtml(dankServing.dankPort, '/', html => {
        assert.ok(!html.includes('Notifications.css'))
        assert.ok(!html.includes('Notifications.js'))
    })
    using esbuildEvents = new EsbuildEvents(dankServing.esbuildPort)
    await Promise.all([
        writeFile(join(testDir, 'pages', 'Notifications.ts'), ``),
        writeFile(join(testDir, 'pages', 'Notifications.css'), ``),
    ])
    let noNextEvent = true
    esbuildEvents.nextEvent().then(() => (noNextEvent = false))
    await new Promise(res => setTimeout(res, 2000))
    assert.ok(noNextEvent)
})
