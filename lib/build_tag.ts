import { exec } from 'node:child_process'
import type { DankConfig } from './dank.ts'
import type { DankFlags } from './flags.ts'

export async function createBuildTag(
    projectDir: string,
    flags: DankFlags,
    buildTagSource?: DankConfig['buildTag'],
): Promise<string> {
    if (typeof buildTagSource === 'function') {
        buildTagSource = await buildTagSource({ production: flags.production })
    }
    if (typeof buildTagSource === 'undefined' || buildTagSource === null) {
        buildTagSource = await resolveExpressionDefault(projectDir)
    }
    if (typeof buildTagSource !== 'string') {
        throw TypeError(
            'DankConfig.buildTag must resolve to a string expession',
        )
    }
    const params: BuildTagParams = {}
    const now = new Date()
    const paramPattern = new RegExp(/{{\s*(?<name>[a-z][A-Za-z]+)\s*}}/g)
    let paramMatch: RegExpExecArray | null
    let buildTag = buildTagSource
    let offset = 0
    while ((paramMatch = paramPattern.exec(buildTagSource)) != null) {
        const paramName = paramMatch.groups!.name.trim() as keyof BuildTagParams
        let paramValue: string
        if (params[paramName]) {
            paramValue = params[paramName]
        } else {
            paramValue = params[paramName] = await getParamValue(
                projectDir,
                paramName,
                now,
                buildTagSource,
            )
        }
        buildTag =
            buildTag.substring(0, paramMatch.index + offset) +
            paramValue +
            buildTag.substring(paramMatch.index + paramMatch[0].length + offset)
        offset += paramValue.length - paramMatch[0].length
    }
    const validate = /^[A-Za-z\d][A-Za-z\d-_\.]+$/
    if (!validate.test(buildTag)) {
        throw Error(
            `build tag ${buildTag} does not pass pattern ${validate.source} validation`,
        )
    }
    return buildTag
}

async function resolveExpressionDefault(projectDir: string): Promise<string> {
    const base = '{{ date }}-{{ timeMS }}'
    const isGitRepo = await new Promise(res =>
        exec('git rev-parse --is-inside-work-tree', { cwd: projectDir }, err =>
            res(!err),
        ),
    )
    return isGitRepo ? base + '-{{ gitHash }}' : base
}

type BuildTagParams = {
    date?: string
    gitHash?: string
    timeMS?: string
}

async function getParamValue(
    projectDir: string,
    name: keyof BuildTagParams,
    now: Date,
    buildTagSource: string,
): Promise<string> {
    switch (name) {
        case 'date':
            return getDate(now)
        case 'gitHash':
            try {
                return await getGitHash(projectDir)
            } catch (e) {
                if (e === 'not-repo') {
                    throw Error(
                        `buildTag cannot use \`gitHash\` in \`${buildTagSource}\` outside of a git repository`,
                    )
                } else {
                    throw e
                }
            }
        case 'timeMS':
            return getTimeMS(now)
        default:
            throw Error(name + ' is not a supported build tag param')
    }
}

function getDate(now: Date): string {
    return now.toISOString().substring(0, 10)
}

async function getGitHash(projectDir: string): Promise<string> {
    return await new Promise((res, rej) =>
        exec(
            'git rev-parse --short HEAD',
            { cwd: projectDir },
            (err, stdout, stderr) => {
                if (err) {
                    if (stderr.includes('not a git repository')) {
                        rej('not-repo')
                    } else {
                        rej(err)
                    }
                }
                res(stdout.trim())
            },
        ),
    )
}

function getTimeMS(now: Date): string {
    const ms =
        now.getUTCMilliseconds() +
        now.getUTCSeconds() * 1000 +
        now.getUTCMinutes() * 1000 * 60 +
        now.getUTCHours() * 1000 * 60 * 60
    return String(ms).padStart(8, '0')
}
