import type { Location, PartialMessage } from 'esbuild'
import type { Resolver } from './dirs.ts'
import { buildMessageLocation } from './esbuild_messages.ts'
import type { WorkerCtorRegistration, WorkerType } from './registry.ts'
import { sourceReplace, type SourceReplacement } from './source_replace.ts'

export type WorkerParseResult = {
    errors?: Array<PartialMessage>
    result: string
    workers: Array<WorkerCtorRegistration>
}

const EXT_JS_TS = /\.(tsx?|jsx?|mjs|mts)$/
const PATH_SEP_TO_UNDERSCORE = /[\/|\\]/g
const WORKER_CTOR_REGEX =
    /new(?:\s|\r?\n)+(?<ctor>(?:Shared)?Worker)(?:\s|\r?\n)*\((?:\s|\r?\n)*(?<url>.*?)(?:\s|\r?\n)*(?<end>[),])/g
const WORKER_CTOR_MODULE_REGEX =
    /\((?:\s|\r?\n)*['"`][^'"`]+['"`](?:\s|\r?\n)*,(?:\s|\r?\n)*\{[^}]*?['"]?\btype['"]?(?:\s|\r?\n)*:(?:\s|\r?\n)*['"]module['"]/
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
        const entrypointIn = resolver.resolvePagesRelativeHrefInProjectDir(
            clientScript,
            originalCtorSrc,
        )
        if (entrypointIn === 'outofbounds') {
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
        const workerType = resolveWorkerTypeFromCtor(js, workerCtorMatch.index)
        const entrypointOut = workerOutPathOf(entrypointIn, workerType)
        const placeholderCtorSrc: `/${string}` = `/${entrypointOut}`
        replacements.push([
            workerCtorMatch.index,
            workerCtorMatch.index + workerCtorMatch[0].length,
            `new ${ctor}('${placeholderCtorSrc}'${workerCtorMatch.groups!.end}`,
        ])
        workers.push({
            clientScript,
            ctor,
            entrypointIn,
            entrypointOut,
            originalCtorSrc,
            placeholderCtorSrc,
            workerType,
        })
    }
    return {
        errors,
        result: replacements.length ? sourceReplace(js, replacements) : js,
        workers,
    }
}

export function workerOutPathOf(path: string, type: WorkerType): string {
    return (
        '.lib/w/' +
        path
            .replace(EXT_JS_TS, `.${type === 'module' ? 'esm' : 'classic'}.js`)
            .replaceAll(PATH_SEP_TO_UNDERSCORE, '_')
    )
}

function resolveWorkerTypeFromCtor(js: string, ctorIndex: number): WorkerType {
    let ctorIndexEnd = -1
    let parenOpen = 0
    for (let i = ctorIndex; i < js.length; i++) {
        const c = js.at(i)
        if (c === '(') {
            parenOpen++
        } else if (c === ')') {
            parenOpen--
            if (parenOpen === 0) {
                ctorIndexEnd = i + 1
                break
            }
        }
    }
    const ctorJs = js.substring(ctorIndex, ctorIndexEnd)
    return WORKER_CTOR_MODULE_REGEX.test(ctorJs) ? 'module' : 'classic'
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
