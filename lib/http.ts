import { createReadStream } from 'node:fs'
import {
    createServer,
    type IncomingHttpHeaders,
    type IncomingMessage,
    type OutgoingHttpHeaders,
    type ServerResponse,
} from 'node:http'
import { extname, join as fsJoin } from 'node:path'
import {
    createRoutes,
    hasServerEnvValues,
    type HttpMethod,
    type RequestHandler,
} from '@sidelines/server/routes'
import { isProductionBuild } from './flags.ts'

export type FrontendFetcher = (
    url: URL,
    headers: Headers,
    res: ServerResponse,
) => void

export function createEsbuildFilesFetcher(
    esbuildPort: number,
): FrontendFetcher {
    return (url: URL, _headers: Headers, res: ServerResponse) => {
        fetch(`http://127.0.0.1:${esbuildPort}${url.pathname}`).then(
            fetchResponse => {
                res.writeHead(
                    fetchResponse.status,
                    convertHeadersFromFetch(fetchResponse.headers),
                )
                fetchResponse.bytes().then(data => res.end(data))
            },
        )
    }
}

export function createFrontendFilesFetcher(
    dir: string,
    files: Set<string>,
): FrontendFetcher {
    return (url: URL, _headers: Headers, res: ServerResponse) => {
        if (!files.has(url.pathname)) {
            res.writeHead(404)
            res.end()
        } else {
            const mimeType = resolveMimeType(url)
            res.setHeader('Content-Type', mimeType)
            const reading = createReadStream(
                mimeType === 'text/html'
                    ? fsJoin(dir, url.pathname, 'index.html')
                    : fsJoin(dir, url.pathname),
            )
            reading.pipe(res)
            reading.on('error', err => {
                console.error(
                    `${url.pathname} file read ${reading.path} error ${err.message}`,
                )
                res.statusCode = 500
                res.end()
            })
        }
    }
}

function resolveMimeType(url: URL): string {
    switch (extname(url.pathname)) {
        case '':
            return 'text/html'
        case '.js':
            return 'text/javascript'
        case '.json':
            return 'application/json'
        case '.css':
            return 'text/css'
        case '.svg':
            return 'image/svg+xml'
        case '.png':
            return 'image/png'
        default:
            console.warn('? mime type for', url.pathname)
            if (!isProductionBuild()) process.exit(1)
            return 'application/octet-stream'
    }
}

export function createWebServer(
    frontendFetcher: FrontendFetcher,
): ReturnType<typeof createServer> {
    if (!hasServerEnvValues(process.env)) {
        throw Error('missing env vars for web server')
    }
    const routes = createRoutes(process.env)
    return createServer((req: IncomingMessage, res: ServerResponse) => {
        if (!req.url || !req.method) {
            res.end()
        } else {
            const url = new URL(`${process.env.WEBAPP_ADDRESS}${req.url}`)
            if (!url.pathname.startsWith('/assets/sidelines/icons/'))
                console.log(req.method, url.pathname)
            if (routes[url.pathname]) {
                const route = routes[url.pathname][req.method as HttpMethod]
                if (!route) {
                    res.writeHead(405)
                    res.end()
                } else {
                    invokeRoute(url, req, res, route)
                }
            } else if (req.method !== 'GET') {
                res.writeHead(405)
                res.end()
            } else {
                frontendFetcher(url, convertHeadersToFetch(req.headers), res)
            }
        }
    })
}

function invokeRoute(
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
    route: RequestHandler,
) {
    const result = route(
        new Request(url, {
            method: req.method,
            headers: convertHeadersToFetch(req.headers),
        }),
    )
    if (result instanceof Response) {
        sendFetchResponse(result, res)
    } else if (result instanceof Promise) {
        result.then(fetchResponse => sendFetchResponse(fetchResponse, res))
    } else {
        console.error('route did not return a Response or Promise<Response>')
        res.end()
    }
}

function sendFetchResponse(
    fetchResponse: Response,
    serverResponse: ServerResponse,
) {
    serverResponse.writeHead(
        fetchResponse.status,
        convertHeadersFromFetch(fetchResponse.headers),
    )
    if (fetchResponse.body) {
        fetchResponse.text().then(data => serverResponse.end(data))
    } else {
        serverResponse.end()
    }
}

function convertHeadersFromFetch(from: Headers): OutgoingHttpHeaders {
    const to: OutgoingHttpHeaders = {}
    for (const name of from.keys()) {
        to[name] = from.get(name)!
    }
    return to
}

function convertHeadersToFetch(from: IncomingHttpHeaders): Headers {
    const to = new Headers()
    for (const [name, values] of Object.entries(from)) {
        if (Array.isArray(values)) {
            for (const value of values) to.append(name, value)
        } else if (values) {
            to.set(name, values)
        }
    }
    return to
}
