import { bold, green, red } from './ansi.ts'
import { DevServices } from './services.ts'

export function configureDevServicesOutput(services: DevServices) {
    services.on('error', (label, cause) =>
        console.log(formatServiceLabel(label), 'errored:', cause),
    )
    services.on('exit', (label, code) => {
        if (code) {
            console.log(formatServiceLabel(label), 'exited', code)
        } else {
            console.log(formatServiceLabel(label), 'exited')
        }
    })
    services.on('launch', label =>
        console.log(formatServiceLabel(label), 'starting'),
    )
    services.on('stdout', (label, output) =>
        printServiceOutput(label, green, output),
    )
    services.on('stderr', (label, output) =>
        printServiceOutput(label, red, output),
    )
}

function formatServiceLabel(label: string): string {
    return `${bold('|')} ${label} ${bold('|')}`
}

function formatServiceOutputLabel(
    label: string,
    color: (s: string) => string,
): string {
    return color(formatServiceLabel(label))
}

function printServiceOutput(
    label: string,
    color: (s: string) => string,
    output: Array<string>,
) {
    const formattedLabel = formatServiceOutputLabel(label, color)
    for (const line of output) console.log(formattedLabel, line)
}
