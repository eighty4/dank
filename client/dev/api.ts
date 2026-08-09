import type {
    DankDevApiMethodKind,
    DankDevApiRequest,
    DankDevApiResponse,
} from '../../lib/dev_api.ts'

export async function dankDevApi<K extends DankDevApiMethodKind>(
    req: DankDevApiRequest<K>,
): Promise<DankDevApiResponse<K>> {
    const fetchRes = await fetch('/@dank/dev/api', {
        method: 'POST',
        body: JSON.stringify(req),
        headers: {
            'content-type': 'application/json',
        },
    })
    return await fetchRes.json()
}
