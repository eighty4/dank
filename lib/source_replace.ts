export type SourceReplacement = [startI: number, endI: number, content: string]

export function sourceReplace(
    source: string,
    replacements: Array<SourceReplacement>,
): string {
    let offset = 0
    for (const [startI, endI, content] of replacements) {
        source =
            source.substring(0, startI + offset) +
            content +
            source.substring(endI + offset)
        offset += content.length - (endI - startI)
    }
    return source
}
