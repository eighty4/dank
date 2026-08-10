import type { ResolvedDankConfig } from './config.ts'
import type {
    DankDevApiMethodKind,
    DankDevApiRequest,
    DankDevApiResponse,
    DankDevPage,
} from './dev_api.ts'

export class DankDevApi {
    #c: ResolvedDankConfig
    #handlers: DankDevApiHandlers = {
        'dev-pages': fetchDevPages,
    }

    constructor(c: ResolvedDankConfig) {
        this.#c = c
    }

    async invokeReq<
        K extends DankDevApiMethodKind,
        REQ extends DankDevApiRequest<K>,
    >(req: REQ): Promise<DankDevApiResponse<K>> {
        return await this.#handlers[req.kind](this.#c, req)
    }
}

type DankDevApiHandlers = {
    [K in DankDevApiMethodKind]: DankDevApiHandler<K>
}

type DankDevApiHandler<K extends DankDevApiMethodKind> = (
    c: ResolvedDankConfig,
    req: DankDevApiRequest<K>,
) => Promise<DankDevApiResponse<K>>

async function fetchDevPages(
    c: ResolvedDankConfig,
    _: DankDevApiRequest<'dev-pages'>,
): Promise<DankDevApiResponse<'dev-pages'>> {
    const pages: Array<DankDevPage> = Object.entries(c.devPages).map(
        ([url, mapping]) => {
            return {
                url: url as `/${string}`,
                label: mapping.label || mapping.webpage,
            }
        },
    )
    return { kind: 'dev-pages', pages }
}
