import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import {
    createServer,
    type IncomingHttpHeaders,
    type IncomingMessage,
    type OutgoingHttpHeaders,
    type ServerResponse,
} from 'node:http'
import { extname, join } from 'node:path'
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
            const p =
                extname(url.pathname) === ''
                    ? join(dir, url.pathname, 'index.html')
                    : join(dir, url.pathname)
            streamFile(p, res)
        }
    }
}

type DevServeOpts = {
    // ref of original DankConfig['pages'] mapping
    // updated incrementally instead of replacing
    pages: Record<string, string>
    // dir processed html files are written to
    pagesDir: string
    // port to esbuild dev server
    proxyPort: number
    // dir of public assets
    publicDir: string
}

export function createDevServeFilesFetcher(
    opts: DevServeOpts,
): FrontendFetcher {
    const proxyAddress = 'http://127.0.0.1:' + opts.proxyPort
    return (url: URL, _headers: Headers, res: ServerResponse) => {
        if (opts.pages[url.pathname]) {
            streamFile(join(opts.pagesDir, url.pathname + 'index.html'), res)
        } else {
            const maybePublicPath = join(opts.publicDir, url.pathname)
            exists(join(opts.publicDir, url.pathname)).then(fromPublic => {
                if (fromPublic) {
                    streamFile(maybePublicPath, res)
                } else {
                    fetch(proxyAddress + url.pathname).then(fetchResponse => {
                        res.writeHead(
                            fetchResponse.status,
                            convertHeadersFromFetch(fetchResponse.headers),
                        )
                        fetchResponse.bytes().then(data => res.end(data))
                    })
                }
            })
        }
    }
}

async function exists(p: string): Promise<boolean> {
    try {
        const maybe = stat(p)
        return (await maybe).isFile()
    } catch (ignore) {
        return false
    }
}

function streamFile(p: string, res: ServerResponse) {
    const mimeType = resolveMimeType(p)
    res.setHeader('Content-Type', mimeType)
    const reading = createReadStream(p)
    reading.pipe(res)
    reading.on('error', err => {
        console.error(`file read ${reading.path} error ${err.message}`)
        res.statusCode = 500
        res.end()
    })
}

function resolveMimeType(p: string): string {
    switch (extname(p)) {
        case '.html':
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
            console.warn('? mime type for', p)
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
