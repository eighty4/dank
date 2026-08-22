import type { Location, PartialMessage } from 'esbuild'
import type { Resolver } from './dirs.ts'
import type { EsbuildEntrypoint } from './esbuild.ts'
import { buildMessageLocation } from './esbuild_messages.ts'
import type { WorkerCtorRegistration } from './registry.ts'
import { sourceReplace, type SourceReplacement } from './source_replace.ts'

export type WorkerParseResult = {
    errors?: Array<PartialMessage>
    result: string
    workers: Array<WorkerCtorRegistration>
}

const EXT_JS_TS = /\.(tsx?|jsx?|mjs|mts)$/
const WORKER_CTOR_REGEX =
    /new(?:\s|\r?\n)+(?<ctor>(?:Shared)?Worker)(?:\s|\r?\n)*\((?:\s|\r?\n)*(?<url>.*?)(?:\s|\r?\n)*(?<end>[),])/g
const WORKER_URL_STRING_REGEX = /^('.*'|".*")$/
const WORKER_URL_REGEX = /^.*\.(ts|js|mts|mjs)$/

export function parseWorkerCtors(
    path: string,
    js: string,
    resolver: Resolver,
): WorkerParseResult {
    let errors: Array<PartialMessage> | undefined = undefined
    const replacements: Array<SourceReplacement> = []
    const workers: Array<WorkerCtorRegistration> = []
    let clientScript: string | undefined = undefined
    for (const workerCtorMatch of js.matchAll(WORKER_CTOR_REGEX)) {
        if (!WORKER_URL_STRING_REGEX.test(workerCtorMatch.groups!.url)) {
            if (!errors) errors = []
            errors.push(
                invalidWorkerUrlCtorArg(
                    buildMessageLocation(
                        path,
                        js,
                        workerCtorMatch.index,
                        workerCtorMatch[0].length,
                    ),
                    workerCtorMatch,
                ),
            )
            continue
        }
        const originalCtorSrc = workerCtorMatch.groups!.url.substring(
            1,
            workerCtorMatch.groups!.url.length - 1,
        )
        if (!WORKER_URL_REGEX.test(originalCtorSrc)) {
            if (!errors) errors = []
            errors.push(
                invalidWorkerUrlExtension(
                    buildMessageLocation(
                        path,
                        js,
                        workerCtorMatch.index,
                        workerCtorMatch[0].length,
                    ),
                    workerCtorMatch,
                ),
            )
            continue
        }
        if (isIndexCommented(js, workerCtorMatch.index)) {
            continue
        }
        if (!clientScript) {
            clientScript = resolver.projectPathFromAbsolute(path)
        }
        const workerProjectPath = resolver.resolvePagesRelativeHrefInProjectDir(
            clientScript,
            originalCtorSrc,
        )
        if (workerProjectPath === 'outofbounds') {
            if (!errors) errors = []
            errors.push(
                outofboundsWorkerUrlCtorArg(
                    buildMessageLocation(
                        path,
                        js,
                        workerCtorMatch.index,
                        workerCtorMatch[0].length,
                    ),
                    workerCtorMatch,
                ),
            )
            continue
        }
        const ctor = workerCtorMatch.groups!.ctor as 'Worker' | 'SharedWorker'
        const entrypoint: EsbuildEntrypoint = {
            in: workerProjectPath,
            out:
                '.lib/' +
                workerProjectPath
                    .replace(EXT_JS_TS, '.js')
                    .replaceAll('\\', '/'),
        }
        const placeholderCtorSrc: `/${string}` = `/${entrypoint.out}`
        const workerCtorReplacement = `new ${ctor}('${placeholderCtorSrc}'${workerCtorMatch.groups!.end}`
        replacements.push([
            workerCtorMatch.index,
            workerCtorMatch.index + workerCtorMatch[0].length,
            workerCtorReplacement,
        ])
        workers.push({
            clientScript,
            ctor,
            entrypoint,
            originalCtorSrc,
            placeholderCtorSrc,
        })
    }
    return {
        errors,
        result: replacements.length ? sourceReplace(js, replacements) : js,
        workers,
    }
}

function isIndexCommented(contents: string, index: number) {
    const preamble = contents.substring(0, index)
    const lineIndex = preamble.lastIndexOf('\n') || 0
    const lineCommented = /\/\//.test(preamble.substring(lineIndex))
    if (lineCommented) {
        return true
    }
    const blockCommentIndex = preamble.lastIndexOf('/*')
    const blockCommented =
        blockCommentIndex !== -1 &&
        preamble.substring(blockCommentIndex).indexOf('*/') === -1
    return blockCommented
}

function outofboundsWorkerUrlCtorArg(
    location: Location,
    workerCtorMatch: RegExpExecArray,
): PartialMessage {
    return {
        id: 'worker-url-outofbounds',
        text: `The ${workerCtorMatch.groups!.ctor} constructor URL arg \`${workerCtorMatch.groups!.url}\` cannot resolve to a path outside of the project directory`,
        location,
    }
}

function invalidWorkerUrlCtorArg(
    location: Location,
    workerCtorMatch: RegExpExecArray,
): PartialMessage {
    return {
        id: 'worker-url-unresolvable',
        text: `The ${workerCtorMatch.groups!.ctor} constructor URL arg \`${workerCtorMatch.groups!.url}\` must be a relative module path`,
        location,
    }
}

function invalidWorkerUrlExtension(
    location: Location,
    workerCtorMatch: RegExpExecArray,
): PartialMessage {
    const url = workerCtorMatch.groups!.url.slice(1, -1)
    return {
        id: 'worker-url-unsupported-ext',
        text: `The ${workerCtorMatch.groups!.ctor} URL \`${url}\` needs a \`ts\` or \`js\` extension`,
        location: {
            ...location,
            column: location.column + workerCtorMatch[0].lastIndexOf('.'),
            length: url.length - url.lastIndexOf('.'),
        },
    }
}
