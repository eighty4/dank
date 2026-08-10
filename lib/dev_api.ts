export const DANK_DEV_API_PATH = '/@dank/dev/api'

export function isDankDevApiUrl(url: URL): boolean {
    return url.pathname === DANK_DEV_API_PATH
}

export type MenuPane = 'channels' | 'opfs' | 'workers' | 'pages'

export type DankDevPage = {
    label: string
    url: `/${string}`
}

export type DankDevApiMethodKind = 'dev-pages'

export type DankDevApiRequests = {
    'dev-pages': {}
}

export type DankDevApiRequest<K extends DankDevApiMethodKind> = {
    kind: K
} & DankDevApiRequests[K]

export type DankDevApiResponses = {
    'dev-pages': {
        pages: Array<DankDevPage>
    }
}

export type DankDevApiResponse<K extends DankDevApiMethodKind> = {
    kind: K
} & DankDevApiResponses[K]
