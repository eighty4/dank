import type { BuildFailure, Location, Message } from 'esbuild'
import {
    bold,
    gray,
    grayOnGreen,
    green,
    red,
    whiteOnRed,
    whiteOnYellow,
    yellow,
} from './ansi.ts'

// throw for user facing errors
// throw Error to show a stacktrace
export class DankError extends Error {
    constructor(message: string, cause?: Error) {
        super(message, { cause })
        this.name = 'DankError'
    }
}

export function isEsbuildBuildFailure(e: unknown): e is BuildFailure {
    return (
        e !== null &&
        typeof e === 'object' &&
        e instanceof Error &&
        'errors' in e &&
        Array.isArray(e.errors) &&
        'warnings' in e &&
        Array.isArray(e.warnings)
    )
}

export function printEsbuildBuildFailureMessages(
    e: Pick<BuildFailure, 'errors' | 'warnings'>,
) {
    if (e.warnings.length) {
        printEsbuildWarnings(e.warnings)
    }
    if (e.errors.length) {
        const label = labelForErrors()
        for (const error of e.errors) {
            printEsbuildMessage(label, error)
        }
    }
}

export function printEsbuildWarnings(warnings: BuildFailure['warnings']) {
    const label = labelForWarnings()
    for (const warning of warnings) {
        printEsbuildMessage(label, warning)
    }
}

export function printEsbuildRecovered() {
    console.log(
        `   ${grayOnGreen(' DANK ')} ${green('✔')} ${gray('build recovered')}\n`,
    )
}

function labelForErrors(): string {
    return `${red('✘')} ${whiteOnRed(' ERROR ')}`
}

function labelForWarnings(): string {
    return `${yellow('✘')} ${whiteOnYellow(' WARNING ')}`
}

function printEsbuildMessage(label: string, message: Message) {
    console.log(label, bold(message.text))
    if (message.location) {
        printEsbuildLocation(message.location)
    }
    for (const note of message.notes) {
        console.log(`\n  ${note.text}`)
        if (note.location) {
            printEsbuildLocation(note.location)
        }
    }
    console.log()
}

function printEsbuildLocation(location: Location) {
    const { file, line, column, lineText, length } = location
    console.log(`\n    ${file}:${line}:${column}:`)
    const lineBeforeHighlight = lineText.substring(0, column)
    const lineHighlight = lineText.substring(column, column + length)
    const lineAfterHighlight = lineText.substring(column + length)
    console.log(
        `${(line + ' ').padStart(8)}│ ${lineBeforeHighlight}${green(lineHighlight)}${lineAfterHighlight}`,
    )
    console.log(
        `${' '.padStart(8)}╵ ${' '.padStart(lineBeforeHighlight.length)}${green(''.padStart(lineHighlight.length, '~'))}`,
    )
}
