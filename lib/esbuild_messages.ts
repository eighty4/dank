import type { Location } from 'esbuild'

export function buildMessageLocation(
    file: string,
    contents: string,
    matchIndex: number,
    matchLength: number,
    suggestion: string = '',
): Location {
    const preamble = contents.substring(0, matchIndex)
    let lineStart = preamble.lastIndexOf('\n')
    lineStart = lineStart === -1 ? 0 : lineStart + 1
    const lineEnd = contents.indexOf('\n', lineStart)
    return {
        namespace: 'file',
        suggestion,
        file,
        lineText: contents.substring(
            lineStart,
            lineEnd === -1 ? contents.length : lineEnd,
        ),
        line: preamble.match(/\n/g)?.length || 1,
        column: preamble.length - lineStart,
        length: matchLength,
    }
}
