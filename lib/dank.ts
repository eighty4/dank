export type DankConfig = {
    // used for releases and service worker caching
    // buildTag?:  (() => Promise<string> | string) | string
    // mapping url to fs paths of webpages to build
    pages: Record<`/${string}`, `${string}.html`>

    services?: Array<DevService>
}

export type DevService = {
    command: string
    cwd?: string
    env?: Record<string, string>
}

export async function defineConfig(
    c: Partial<DankConfig>,
): Promise<DankConfig> {
    validatePages(c.pages)
    validateDevServices(c.services)
    normalizePagePaths(c.pages)
    return c as DankConfig
}

function validatePages(pages?: DankConfig['pages']) {
    if (
        pages === null ||
        typeof pages === 'undefined' ||
        Object.keys(pages).length === 0
    ) {
        throw Error('DankConfig.pages is required')
    }
    for (const [urlPath, htmlPath] of Object.entries(pages)) {
        if (typeof htmlPath !== 'string' || !htmlPath.endsWith('.html')) {
            throw Error(
                `DankConfig.pages['${urlPath}'] must configure an html file`,
            )
        }
    }
}

function validateDevServices(services: DankConfig['services']) {
    if (services === null || typeof services === 'undefined') {
        return
    }
    if (!Array.isArray(services)) {
        throw Error(`DankConfig.services must be an array`)
    }
    for (let i = 0; i < services.length; i++) {
        const s = services[i]
        if (s.command === null || typeof s.command === 'undefined') {
            throw Error(`DankConfig.services[${i}].command is required`)
        } else if (typeof s.command !== 'string' || s.command.length === 0) {
            throw Error(
                `DankConfig.services[${i}].command must be a non-empty string`,
            )
        }
        if (s.cwd !== null && typeof s.cwd !== 'undefined') {
            if (typeof s.cwd !== 'string' || s.cwd.trim().length === 0) {
                throw Error(
                    `DankConfig.services[${i}].cwd must be a non-empty string`,
                )
            }
        }
        if (s.env !== null && typeof s.env !== 'undefined') {
            if (typeof s.env !== 'object') {
                throw Error(
                    `DankConfig.services[${i}].env must be an env variable map`,
                )
            }
            for (const [k, v] of Object.entries(s.env)) {
                if (typeof v !== 'string') {
                    throw Error(
                        `DankConfig.services[${i}].env[${k}] must be a string`,
                    )
                }
            }
        }
    }
}

function normalizePagePaths(pages: any) {
    for (const urlPath of Object.keys(pages)) {
        pages[urlPath] = pages[urlPath].replace(/^\.\//, '')
    }
}
