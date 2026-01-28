import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import { dirname, resolve } from 'node:path'
import packageJson from '../package.json' with { type: 'json' }

const CONSOLE =
    process.env.DANK_LOG_CONSOLE === '1' ||
    process.env.DANK_LOG_CONSOLE === 'true'
const FILE = process.env.DANK_LOG_FILE
const ROLLING =
    process.env.DANK_LOG_ROLLING === '1' ||
    process.env.DANK_LOG_ROLLING === 'true'

const logs: Array<string> = []
let initialized = false
let preparing: Promise<void>
let stream: WriteStream

export type LogEvent = {
    realm:
        | 'build'
        | 'serve'
        | 'assets'
        | 'config'
        | 'html'
        | 'registry'
        | 'services'
    message: string
    data?: Record<string, LogEventData>
}

type LogEventData =
    | LogEventDatum
    | Array<LogEventDatum>
    | Set<LogEventDatum>
    | Record<string, LogEventDatum>

type LogEventDatum = boolean | number | string | null | undefined

function toStringLogEvent(logEvent: LogEvent): string {
    const when = new Date().toISOString()
    const message = `[${logEvent.realm}] ${logEvent.message}\n${when}\n`
    if (!logEvent.data) {
        return message
    }
    let data = ''
    for (const k of Object.keys(logEvent.data).sort()) {
        data += `\n    ${k} = ${toStringData(logEvent.data[k])}`
    }
    return `${message}${data}\n`
}

function toStringData(datum: LogEventData): string {
    if (datum instanceof Set) {
        datum = Array.from(datum)
    }
    if (
        datum !== null &&
        typeof datum === 'object' &&
        datum.constructor.name === 'Object'
    ) {
        datum = Object.entries(datum).map(([k, v]) => `${k} = ${v}`)
    }
    if (Array.isArray(datum)) {
        if (datum.length === 0) {
            return '[]'
        } else {
            return `[\n        ${datum.join('\n        ')}\n    ]`
        }
    } else {
        return `${datum}`
    }
}

function logToConsoleAndFile(out: string) {
    logToConsole(out)
    logToFile(out)
}

function logToConsole(out: string) {
    console.log('\n' + out)
}

function logToFile(out: string) {
    logs.push(out)
    if (!initialized) {
        initialized = true
        preparing = prepareLogFile().catch(onPrepareLogFileError)
    }
    preparing.then(syncLogs)
}

async function prepareLogFile() {
    const path = resolve(FILE!)
    if (!ROLLING) {
        await rm(path, { force: true })
    }
    await mkdir(dirname(path), { recursive: true })
    stream = createWriteStream(path, { flags: 'a' })
    console.log('debug logging to', FILE)
    logSystemDetails()
}

function logSystemDetails() {
    stream.write(`\
---
os: ${os.type()}
build: ${os.version()}
cpu: ${os.arch()}
cores: ${os.availableParallelism()}
${process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`}
dank: ${packageJson.version}
\n`)
}

function syncLogs() {
    if (!logs.length) return
    const content = logs.join('\n') + '\n'
    logs.length = 0
    stream.write(content)
}

function onPrepareLogFileError(e: any) {
    console.error(`init log file \`${FILE}\` error: ${e.message}`)
    process.exit(1)
}

function makeLogger(
    logDelegate: (out: string) => void,
): (logEvent: LogEvent) => void {
    return logEvent => logDelegate(toStringLogEvent(logEvent))
}

export const LOG = (function resolveLogFn() {
    if (CONSOLE && FILE?.length) {
        return makeLogger(logToConsoleAndFile)
    }
    if (CONSOLE) {
        return makeLogger(logToConsole)
    }
    if (FILE?.length) {
        return makeLogger(logToFile)
    }
    return () => {}
})()
