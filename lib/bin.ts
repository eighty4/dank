#!/usr/bin/env node

import { green, red } from './ansi.ts'
import { buildWebsite } from './build.ts'
import {
    DankError,
    isEsbuildBuildFailure,
    printEsbuildBuildFailureMessages,
} from './errors.ts'
import { serveWebsite } from './serve.ts'

function printHelp(task?: 'build' | 'serve'): never {
    if (!task || task === 'build') {
        console.log('dank build [--service-worker]')
    }
    if (!task || task === 'serve') {
        console.log(
            'dank serve [--log-http] [--minify] [--production] [--service-worker]',
        )
    }
    console.log('\nOPTIONS:')
    if (!task || task === 'serve') {
        console.log('  --log-http        print access logs')
        console.log('  --minify          minify sources')
        console.log('  --production      build for production release')
    }
    console.log('  --service-worker  build service worker')
    if (task) {
        console.log('\nuse `dank -h` for details on all commands')
    }
    process.exit(1)
}

const args = (function collectProgramArgs(): Array<string> {
    const programNames: Array<string> = ['dank', 'bin.js', 'bin.ts']
    let args = [...process.argv]
    while (true) {
        const shifted = args.shift()
        if (!shifted || programNames.some(name => shifted.endsWith(name))) {
            return args
        }
    }
})()

const task: 'build' | 'serve' = (function resolveTask() {
    const showHelp = args.some(arg => arg === '-h' || arg === '--help')
    const task = (() => {
        while (true) {
            const shifted = args.shift()
            switch (shifted) {
                case '-h':
                case '--help':
                    break
                case 'build':
                    return 'build'
                case 'dev':
                case 'serve':
                    return 'serve'
                default:
                    if (showHelp) {
                        printHelp()
                    } else if (typeof shifted === 'undefined') {
                        printCommandError('missing command')
                    } else {
                        printCommandError(shifted + " isn't a command")
                    }
            }
        }
    })()
    if (showHelp) {
        printHelp(task)
    }
    return task
})()

try {
    switch (task) {
        case 'build':
            await buildWebsite()
            console.log(green('done'))
            process.exit(0)
        case 'serve':
            await serveWebsite()
    }
} catch (e: unknown) {
    printError(e)
    process.exit(1)
}

function printCommandError(msg: string): never {
    console.error(red('error:'), msg)
    printHelp()
}

function printError(e: unknown) {
    if (isEsbuildBuildFailure(e)) {
        printEsbuildBuildFailureMessages(e)
    } else {
        console.error(red('error:'), e instanceof DankError ? e.message : e)
    }
}
