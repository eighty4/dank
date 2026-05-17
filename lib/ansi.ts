export function bold(s: string): string {
    return `\u001b[1m${s}\u001b[0m`
}

export function green(s: string): string {
    return `\u001b[32m${s}\u001b[0m`
}

export function red(s: string): string {
    return `\u001b[31m${s}\u001b[0m`
}

export function whiteOnRed(s: string): string {
    return `\u001b[37;41m${s}\u001b[0m`
}

export function yellow(s: string): string {
    return `\u001b[33m${s}\u001b[0m`
}

export function whiteOnYellow(s: string): string {
    return `\u001b[37;43m${s}\u001b[0m`
}
