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
    const listFlags = (flags: Array<string>) =>
        flags.map(s => `[${s}]`).join(' ')
    const SHOW_BUILD = showMode('build')
    const SHOW_SERVE = showMode('serve')
    const SHOW_PREVIEW = showMode('preview')
    if (SHOW_BUILD) {
        console.log('dank build', listFlags(buildFlags()))
    }
    if (SHOW_SERVE) {
        console.log('dank serve', listFlags(serveFlags()), '[HTML]')
    }
    if (SHOW_PREVIEW) {
        console.log('dank preview', listFlags(previewFlags()))
    }
    console.log('\nOPTIONS:')
    if (SHOW_PREVIEW || SHOW_SERVE) {
        console.log('  --log-http        print access logs')
    }
    if (SHOW_SERVE) {
        console.log('  --minify          minify sources')
        console.log('  --no-dank-ui      do not bundle DANK dev UI')
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

validateFlags(mode, args)

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

function printCommandError(msg: string, mode?: DankMode): never {
    console.error(red('error:'), msg)
    printHelp(mode)
}

function printError(e: unknown) {
    if (isEsbuildBuildFailure(e)) {
        printEsbuildBuildFailureMessages(e)
    } else {
        console.error(red('error:'), e instanceof DankError ? e.message : e)
    }
}

function validateFlags(mode: DankMode, args: Array<string>): void | never {
    const valid = modeFlags(mode)
    for (const arg of args) {
        if (arg.startsWith('--') && !valid.includes(arg)) {
            printCommandError(`unknown arg \`${arg}\``, mode)
        }
    }
}

function modeFlags(mode: DankMode): Array<string> {
    switch (mode) {
        case 'build':
            return buildFlags()
        case 'preview':
            return previewFlags()
        case 'serve':
            return serveFlags()
    }
}

function buildFlags(): Array<string> {
    return ['--service-worker']
}

function previewFlags(): Array<string> {
    return ['--log-http', '--service-worker']
}

function serveFlags(): Array<string> {
    return [
        '--log-http',
        '--minify',
        '--no-dank-ui',
        '--production',
        '--service-worker',
    ]
}
