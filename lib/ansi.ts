type ColorDepth = 1 | 4 | 8 | 24

const COLOR_DEPTH: ColorDepth =
    'getColorDepth' in process.stdout
        ? (process.stdout.getColorDepth() as ColorDepth)
        : 1

const NO_COLOR = (s: string) => s

export function bold(s: string): string {
    return `\u001b[1m${s}\u001b[22m`
}

export const gray =
    COLOR_DEPTH === 1 ? NO_COLOR : (s: string) => `\u001b[90m${s}\u001b[0m`

export const grayOnGreen =
    COLOR_DEPTH === 1 ? NO_COLOR : (s: string) => `\u001b[90;42m${s}\u001b[0m`

export const green =
    COLOR_DEPTH === 1 ? NO_COLOR : (s: string) => `\u001b[32m${s}\u001b[0m`

export const red =
    COLOR_DEPTH === 1 ? NO_COLOR : (s: string) => `\u001b[31m${s}\u001b[0m`

export const whiteOnRed =
    COLOR_DEPTH === 1 ? NO_COLOR : (s: string) => `\u001b[37;41m${s}\u001b[0m`

export const yellow =
    COLOR_DEPTH === 1 ? NO_COLOR : (s: string) => `\u001b[33m${s}\u001b[0m`

export const whiteOnYellow =
    COLOR_DEPTH === 1 ? NO_COLOR : (s: string) => `\u001b[37;43m${s}\u001b[0m`
