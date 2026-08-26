import { readFile } from 'node:fs/promises'
import { join } from 'node:path/posix'
import type {
    BuildFailure,
    BuildResult,
    Location,
    Message,
    Note,
    Plugin,
    PluginBuild,
} from 'esbuild'
import type { DankDirectories } from './dirs.ts'
import { buildMessageLocation } from './esbuild_messages.ts'
import {
    printEsbuildBuildFailureMessages,
    printEsbuildRecovered,
} from './errors.ts'
import type {
    WebsiteRegistry,
    WorkerClientManifest,
    WorkerManifest,
} from './registry.ts'

// added to `esbuild.context({plugins})` to enhance errors logged by `esbuild.Context.serve()`
export function createErrorPlugin(r: WebsiteRegistry): Plugin {
    return {
        name: '@eighty4/dank/esbuild/errors',
        setup(build: PluginBuild) {
            if (!build.initialOptions.metafile)
                throw TypeError('plugin requires metafile')

            let prevHadErrors = false

            build.onEnd(async (result: BuildResult<{ metafile: true }>) => {
                if (result.errors.length) {
                    await enhanceEsbuildBuildFailure(r, result)
                    printEsbuildBuildFailureMessages(result)
                    prevHadErrors = true
                } else if (prevHadErrors) {
                    printEsbuildRecovered()
                    prevHadErrors = false
                }
            })
        },
    }
}

export async function enhanceEsbuildBuildFailure(
    r: WebsiteRegistry,
    e: Pick<BuildFailure, 'errors'>,
) {
    const unresolvedEntrypointPattern = new RegExp(
        /^Could not resolve "(?<p>.+?)"$/,
    )
    for (const m of e.errors) {
        if (isIifeTopLevelAwait(m)) {
            await enhanceIifeTopLevelAwaitMessage(r, m)
        } else {
            const unresolvedEntrypointMatch = unresolvedEntrypointPattern.exec(
                m.text,
            )
            if (unresolvedEntrypointMatch) {
                const p = unresolvedEntrypointMatch.groups!.p.replace(
                    /^\.[\/\\]/,
                    '',
                )
                const w = r.allWorkers!.find(w => w.entrypoint === p)
                if (w) {
                    await enhanceUnresolvedWorkerEntrypointMessage(r, m, p, w)
                }
            }
        }
    }
}

function isIifeTopLevelAwait(m: Message): boolean {
    return (
        m.text ===
        'Top-level await is currently not supported with the "iife" output format'
    )
}

async function enhanceIifeTopLevelAwaitMessage(
    r: WebsiteRegistry,
    m: Message,
): Promise<void> {
    m.text = `Top-level await is not supported with the "iife" output format used to bundle classic web workers`
    if (m.location?.file) {
        const wp = m.location.file
        const w = r.allWorkers?.find(w => w.entrypoint === wp)
        if (w) {
            m.notes = (
                await Promise.all(
                    w.clients.map<Promise<Note | null>>(async wc => {
                        const location = await buildLocation(
                            r.dirs,
                            wc.script,
                            workerUrlPattern(wc),
                        )
                        if (!location) {
                            return null
                        }
                        return {
                            text: `Upgrade to module workers for your ${wc.ctor} in "${wc.script}" with \`new ${wc.ctor}('${wc.originalCtorSrc}', {type: 'module'})\``,
                            location,
                        }
                    }),
                )
            ).filter(n => n !== null)
        }
    }
}

async function enhanceUnresolvedWorkerEntrypointMessage(
    r: WebsiteRegistry,
    m: Message,
    unresolvePath: string,
    w: WorkerManifest,
) {
    const wc = w.clients[0]
    m.text = `Could not find ${wc.ctor} entrypoint "${unresolvePath}"`
    const location = await buildLocation(
        r.dirs,
        wc.script,
        workerUrlPattern(wc),
    )
    if (location) {
        m.notes = [
            {
                text: `The ${wc.ctor} entrypoint was found in "${wc.script}":`,
                location,
            },
        ]
    }
}

function workerUrlPattern(wc: WorkerClientManifest): RegExp {
    const workerUrl = RegExp.escape(wc.originalCtorSrc)
    return new RegExp(
        `new(?:\\s|\\r?\\n)+${wc.ctor}(?:\\s|\\r?\\n)*\\((?:\\s|\\r?\\n)*('${workerUrl}'|"${workerUrl}")(?:\\s|\\r?\\n)*[),]`,
    )
}

async function buildLocation(
    dirs: DankDirectories,
    f: string,
    p: RegExp,
): Promise<Location | null> {
    const source = await readFile(join(dirs.projectRootAbs, f), 'utf8')
    const m = p.exec(source)
    if (!m) {
        return null
    }
    const highlight = m.at(-1)!
    return buildMessageLocation(
        f,
        source,
        m.index + m[0].indexOf(highlight),
        highlight.length,
    )
}
