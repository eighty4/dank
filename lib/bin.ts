#!/usr/bin/env node

import { buildWebsite } from './build.ts'
import { loadConfig } from './config.ts'
import { serveWebsite } from './serve.ts'

function printHelp(task?: 'build' | 'serve'): never {
    if (!task || task === 'build') {
        console.log('dank build [--minify] [--production]')
    }
    if (!task || task === 'serve') {
        console.log(
            // 'dank serve [--minify] [--preview] [--production]',
            'dank serve [--minify] [--production]',
        )
    }
    console.log('\nOPTIONS:')
    if (!task || task === 'serve')
        console.log('  --log-http     print access logs')
    console.log('  --minify       minify sources')
    // if (!task || task === 'serve') console.log('  --preview      pre-bundle and build ServiceWorker')
    console.log('  --production   build for production release')
    if (task) {
        console.log()
        console.log('use `dank -h` for details on all commands')
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
                        printError('missing command')
                        printHelp()
                    } else {
                        printError(shifted + " isn't a command")
                        printHelp()
                    }
            }
        }
    })()
    if (showHelp) {
        printHelp(task)
    }
    return task
})()

const c = await loadConfig()

try {
    switch (task) {
        case 'build':
            await buildWebsite(c)
            console.log(green('done'))
            process.exit(0)
        case 'serve':
            await serveWebsite(c)
    }
} catch (e: unknown) {
    errorExit(e)
}

function printError(e: unknown) {
    if (e !== null) {
        if (typeof e === 'string') {
            console.error(red('error:'), e)
        } else if (e instanceof Error) {
            console.error(red('error:'), e.message)
            if (e.stack) {
                console.error(e.stack)
            }
        }
    }
}

function green(s: string): string {
    return `\u001b[32m${s}\u001b[0m`
}

function red(s: string): string {
    return `\u001b[31m${s}\u001b[0m`
}

function errorExit(e?: unknown): never {
    printError(e)
    process.exit(1)
}
