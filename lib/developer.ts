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
    | LogEventDataArray
    | LogEventDataRecord
    | LogEventDataSet

type LogEventDatum = boolean | number | string | null | undefined

type LogEventDataArray = Array<LogEventDatum> | Array<LogEventDataRecord>

type LogEventDataRecord = Record<
    string,
    LogEventDatum | LogEventDataArray | LogEventDataSet
>

type LogEventDataSet = Set<LogEventDatum>

function toStringLogEvent(logEvent: LogEvent): string {
    const when = new Date().toISOString()
    const message = `[${logEvent.realm}] ${logEvent.message}\n${when}\n`
    if (logEvent.data) {
        const data: string = Object.keys(logEvent.data)
            .sort()
            .map(key => toStringData(key, logEvent.data![key]))
            .join('')
        return `${message}\n${data}`
    } else {
        return message
    }
}

const PAD = '    '
const nextIndent = (pad: string) => pad + PAD

function toStringData(
    key: string,
    data: LogEventData,
    pad: string = PAD,
): string {
    const prepend = `${pad}${key} = `
    if (isDataAbsentOrScalar(data)) {
        return `${prepend}${toStringDatum(data)}`
    }
    if (data instanceof Set) {
        data = Array.from(data)
    }
    if (Array.isArray(data)) {
        return `${prepend}${toStringArray(data, pad)}`
    } else {
        return `${prepend}${toStringRecord(data, pad)}`
    }
}

function toStringDatum(datum: LogEventDatum): string {
    return `${datum}\n`
}

function toStringArray(array: LogEventDataArray, padEnding: string): string {
    if (array.length === 0) {
        return '[]'
    }
    const padIndent = nextIndent(padEnding)
    const content = array
        .map(datum => {
            if (isDataAbsentOrScalar(datum)) {
                return toStringDatum(datum)
            } else {
                return toStringRecord(datum, padIndent)
            }
        })
        .join(padIndent)
    return `[\n${padIndent}${content}${padEnding}]\n`
}

function toStringRecord(record: LogEventDataRecord, padEnding: string): string {
    const keys = Object.keys(record)
    if (keys.length === 0) {
        return '{}'
    }
    const padIndent = nextIndent(padEnding)
    const content = keys
        .map(key => toStringData(key, record[key], padIndent))
        .join('')
    return `{\n${content}${padEnding}}\n`
}

function isDataAbsentOrScalar(
    data: LogEventData,
): data is undefined | null | string | boolean | number {
    switch (typeof data) {
        case 'undefined':
        case 'string':
        case 'boolean':
        case 'number':
            return true
        default:
            return data === null
    }
}

function logToConsoleAndFile(out: string) {
    logToConsole(out)
    logToFile(out)
}

function logToConsole(out: string) {
    console.log(out)
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
