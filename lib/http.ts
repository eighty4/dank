import { createReadStream } from 'node:fs'
import {
    createServer,
    type IncomingHttpHeaders,
    type IncomingMessage,
    type OutgoingHttpHeaders,
    type ServerResponse,
} from 'node:http'
import { extname, join as fsJoin } from 'node:path'
import { isProductionBuild } from './flags.ts'

export type FrontendFetcher = (
    url: URL,
    headers: Headers,
    res: ServerResponse,
) => void

export function createWebServer(
    port: number,
    frontendFetcher: FrontendFetcher,
): ReturnType<typeof createServer> {
    const serverAddress = 'http://localhost:' + port
    return createServer((req: IncomingMessage, res: ServerResponse) => {
        if (!req.url || !req.method) {
            res.end()
        } else {
            const url = new URL(serverAddress + req.url)
            if (req.method !== 'GET') {
                res.writeHead(405)
                res.end()
            } else {
                frontendFetcher(url, convertHeadersToFetch(req.headers), res)
            }
        }
    })
}

export function createBuiltDistFilesFetcher(
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

export function createLocalProxyFilesFetcher(port: number): FrontendFetcher {
    const proxyAddress = 'http://127.0.0.1:' + port
    return (url: URL, _headers: Headers, res: ServerResponse) => {
        fetch(proxyAddress + url.pathname).then(fetchResponse => {
            res.writeHead(
                fetchResponse.status,
                convertHeadersFromFetch(fetchResponse.headers),
            )
            fetchResponse.bytes().then(data => res.end(data))
        })
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
        case '.ttf':
            return 'font/ttf'
        case '.woff':
            return 'font/woff'
        case '.woff2':
            return 'font/woff2'
        default:
            console.warn('? mime type for', url.pathname)
            if (!isProductionBuild()) process.exit(1)
            return 'application/octet-stream'
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
