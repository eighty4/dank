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

export function printEsbuildRecovered() {
    console.log(
        `\n   ${grayOnGreen(' DANK ')} ${green('✔')} ${gray('build recovered')}\n`,
    )
}

export function printEsbuildBuildFailureMessages(
    e: Pick<BuildFailure, 'errors' | 'warnings'>,
) {
    const lines: Array<Array<string>> = []
    if (e.warnings.length) {
        const label = labelForWarnings()
        lines.push(
            ...e.warnings.map(warning =>
                makePrintableEsbuildMessage(label, warning),
            ),
        )
    }
    if (e.errors.length) {
        const label = labelForErrors()
        lines.push(
            ...e.errors.map(error => makePrintableEsbuildMessage(label, error)),
        )
    }
    console.log(joinAndPadBuildMessages(lines))
}

export function printEsbuildWarnings(warnings: BuildFailure['warnings']) {
    const label = labelForWarnings()
    console.log(
        joinAndPadBuildMessages(
            warnings.map(warning =>
                makePrintableEsbuildMessage(label, warning),
            ),
        ),
    )
}

function joinAndPadBuildMessages(messages: Array<Array<string>>): string {
    return `\n${messages.map(msgs => msgs.join('\n')).join('\n\n')}\n`
}

function labelForErrors(): string {
    return `${red('✘')} ${whiteOnRed(' ERROR ')}`
}

function labelForWarnings(): string {
    return `${yellow('✘')} ${whiteOnYellow(' WARNING ')}`
}

function makePrintableEsbuildMessage(
    label: string,
    message: Message,
): Array<string> {
    const lines = [`${label} ${bold(message.text)}`]
    if (message.location) {
        lines.push(...makePrintableEsbuildLocation(message.location))
    }
    for (const note of message.notes) {
        lines.push('', `  ${note.text}`)
        if (note.location) {
            lines.push('', ...makePrintableEsbuildLocation(note.location))
        }
    }
    return lines
}

function makePrintableEsbuildLocation(location: Location): Array<string> {
    const { file, line, column, lineText, length } = location
    const lineBeforeHighlight = lineText.substring(0, column)
    const lineHighlight = lineText.substring(column, column + length)
    const lineAfterHighlight = lineText.substring(column + length)
    return [
        `    ${file}:${line}:${column}:`,
        `${(line + ' ').padStart(8)}│ ${lineBeforeHighlight}${green(lineHighlight)}${lineAfterHighlight}`,
        `${' '.padStart(8)}╵ ${' '.padStart(lineBeforeHighlight.length)}${green(''.padStart(lineHighlight.length, '~'))}`,
    ]
}
