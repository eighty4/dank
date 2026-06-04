#!/usr/bin/env node

import { green, red } from './ansi.ts'
import { buildWebsite } from './build.ts'
import type { DankMode } from './dank.ts'
import {
    DankError,
    isEsbuildBuildFailure,
    printEsbuildBuildFailureMessages,
} from './errors.ts'
import { serveWebsite } from './serve.ts'

function printHelp(mode?: DankMode): never {
    const showMode = (m: DankMode) => !mode || mode === m
    const SHOW_BUILD = showMode('build')
    const SHOW_SERVE = showMode('serve')
    const SHOW_PREVIEW = showMode('preview')
    if (SHOW_BUILD) {
        console.log('dank build [--service-worker]')
    }
    if (SHOW_SERVE) {
        console.log(
            'dank serve [--log-http] [--minify] [--production] [--service-worker]',
        )
    }
    if (SHOW_PREVIEW) {
        console.log('dank preview [--log-http] [--service-worker]')
    }
    console.log('\nOPTIONS:')
    if (SHOW_PREVIEW || SHOW_SERVE) {
        console.log('  --log-http        print access logs')
    }
    if (SHOW_SERVE) {
        console.log('  --minify          minify sources')
        console.log('  --production      build for production release')
    }
    console.log('  --service-worker  build service worker')
    if (mode) {
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

const mode: DankMode = (function resolveMode() {
    const showHelp = args.some(arg => arg === '-h' || arg === '--help')
    const mode = (() => {
        while (true) {
            const shifted = args.shift()
            switch (shifted) {
                case '-h':
                case '--help':
                    break
                case 'build':
                    return 'build'
                case 'preview':
                    return 'preview'
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
        printHelp(mode)
    }
    return mode
})()

try {
    switch (mode) {
        case 'build':
            await buildWebsite()
            console.log(green('done'))
            process.exit(0)
        case 'serve':
        case 'preview':
            await serveWebsite(mode)
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
