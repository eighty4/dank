export type DankConfig = {
    // used for releases and service worker caching
    // buildTag?:  (() => Promise<string> | string) | string
    // mapping url to fs paths of webpages to build
    pages: Record<`/${string}`, `./${string}.html`>
}

export async function defineConfig(
    c: Partial<DankConfig>,
): Promise<DankConfig> {
    if (typeof c.pages === 'undefined' || Object.keys(c.pages).length === 0) {
        throw Error('DankConfig.pages is required')
    }
    for (const [urlPath, htmlPath] of Object.entries(c.pages)) {
        if (typeof htmlPath !== 'string' || !htmlPath.endsWith('.html')) {
            throw Error(
                `DankConfig.pages['${urlPath}'] must configure an html file`,
            )
        }
    }
    return c as DankConfig
}
