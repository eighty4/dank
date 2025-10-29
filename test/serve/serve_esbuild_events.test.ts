import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import {
    createDank,
    dankServe,
    readReplaceWrite,
} from '../dank_project_testing.ts'
import { EsbuildEvents } from '../esbuild_events_testing.ts'

test('partial with js and css entrypoints dispatch esbuild events', async () => {
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
    const abortController = new AbortController()
    const dankServing = await dankServe(testDir, abortController.signal)
    dankServing.on('error', assert.fail)
    dankServing.on('exit', assert.fail)
    const esbuildEvents = new EsbuildEvents(dankServing.esbuildPort)
    esbuildEvents.on('error', assert.fail)
    await esbuildEvents.connect(abortController.signal)
    try {
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
    } finally {
        abortController.abort()
    }
})
