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
import { Readable } from 'node:stream'
import mime from 'mime'
import type { DankServe } from './flags.ts'
import type { HttpServices } from './services.ts'

export type FrontendFetcher = (
    url: URL,
    headers: Headers,
    res: ServerResponse,
    notFound: () => void,
) => void

export function startWebServer(
    serve: DankServe,
    frontendFetcher: FrontendFetcher,
    httpServices: HttpServices,
) {
    const serverAddress = 'http://localhost:' + serve.dankPort
    const handler = (req: IncomingMessage, res: ServerResponse) => {
        if (!req.url || !req.method) {
            res.end()
        } else {
            const url = new URL(serverAddress + req.url)
            const headers = convertHeadersToFetch(req.headers)
            frontendFetcher(url, headers, res, () => {
                collectReqBody(req).then(body =>
                    tryHttpServices(
                        req.method!,
                        url,
                        headers,
                        body,
                        httpServices,
                    ).then(fetchResponse => {
                        if (fetchResponse === null) {
                            res.writeHead(404)
                            res.end()
                        } else {
                            res.writeHead(
                                fetchResponse.status,
                                undefined,
                                convertHeadersFromFetch(fetchResponse.headers),
                            )
                            if (fetchResponse.body) {
                                Readable.fromWeb(fetchResponse.body).pipe(res)
                            } else {
                                res.end()
                            }
                        }
                    }),
                )
            })
        }
    }
    createServer(serve.logHttp ? createLogWrapper(handler) : handler).listen(
        serve.dankPort,
    )
    console.log(
        serve.preview ? 'preview' : 'dev',
        `server is live at http://127.0.0.1:${serve.dankPort}`,
    )
}

function collectReqBody(req: IncomingMessage): Promise<string | null> {
    let body = ''
    req.on('data', data => (body += data.toString()))
    return new Promise(res =>
        req.on('end', () => res(body.length ? body : null)),
    )
}

async function tryHttpServices(
    method: string,
    url: URL,
    headers: Headers,
    body: string | null,
    httpServices: HttpServices,
): Promise<Response | null> {
    const { running } = httpServices
    for (const httpService of running) {
        const proxyUrl = new URL(url)
        proxyUrl.port = `${httpService.port}`
        try {
            const response = await retryFetchWithTimeout(proxyUrl, {
                body,
                headers,
                method,
                redirect: 'manual',
            })
            if (response.status === 404 || response.status === 405) {
                continue
            } else {
                return response
            }
        } catch (e: any) {
            if (e === 'retrytimeout') {
                continue
            } else {
                errorExit(
                    `unexpected error http proxying to port ${httpService.port}: ${e.message}`,
                )
            }
        }
    }
    return null
}

type RequestListener = (req: IncomingMessage, res: ServerResponse) => void
function createLogWrapper(handler: RequestListener): RequestListener {
    return (req, res) => {
        console.log('  > ', req.method, req.url)
        res.on('close', () => {
            console.log('', res.statusCode, req.method, req.url)
        })
        handler(req, res)
    }
}

export function createBuiltDistFilesFetcher(
    dir: string,
    files: Set<string>,
): FrontendFetcher {
    return (
        url: URL,
        _headers: Headers,
        res: ServerResponse,
        notFound: () => void,
    ) => {
        if (!files.has(url.pathname)) {
            notFound()
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
    return (
        url: URL,
        _headers: Headers,
        res: ServerResponse,
        notFound: () => void,
    ) => {
        if (opts.pages[url.pathname]) {
            streamFile(join(opts.pagesDir, url.pathname, 'index.html'), res)
        } else {
            const maybePublicPath = join(opts.publicDir, url.pathname)
            exists(maybePublicPath).then(fromPublic => {
                if (fromPublic) {
                    streamFile(maybePublicPath, res)
                } else {
                    retryFetchWithTimeout(proxyAddress + url.pathname)
                        .then(fetchResponse => {
                            if (fetchResponse.status === 404) {
                                notFound()
                            } else {
                                res.writeHead(
                                    fetchResponse.status,
                                    convertHeadersFromFetch(
                                        fetchResponse.headers,
                                    ),
                                )
                                fetchResponse
                                    .bytes()
                                    .then(data => res.end(data))
                            }
                        })
                        .catch(e => {
                            if (isFetchRetryTimeout(e)) {
                                res.writeHead(504)
                            } else {
                                console.error(
                                    'unknown frontend proxy fetch error:',
                                    e,
                                )
                                res.writeHead(502)
                            }
                            res.end()
                        })
                }
            })
        }
    }
}

const PROXY_FETCH_RETRY_INTERVAL = 27
const PROXY_FETCH_RETRY_TIMEOUT = 1000

async function retryFetchWithTimeout(
    url: URL | string,
    requestInit?: RequestInit,
): Promise<Response> {
    let timeout = Date.now() + PROXY_FETCH_RETRY_TIMEOUT
    while (true) {
        try {
            return await fetch(url, requestInit)
        } catch (e: any) {
            if (isNodeFailedFetch(e) || isBunFailedFetch(e)) {
                if (timeout < Date.now()) {
                    throw 'retrytimeout'
                } else {
                    await new Promise(res =>
                        setTimeout(res, PROXY_FETCH_RETRY_INTERVAL),
                    )
                }
            } else {
                throw e
            }
        }
    }
}

function isFetchRetryTimeout(e: any): boolean {
    return e === 'retrytimeout'
}

function isBunFailedFetch(e: any): boolean {
    return e.code === 'ConnectionRefused'
}

function isNodeFailedFetch(e: any): boolean {
    return e.message === 'fetch failed'
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
    res.setHeader('Content-Type', mime.getType(p) || 'application/octet-stream')
    const reading = createReadStream(p)
    reading.pipe(res)
    reading.on('error', err => {
        console.error(`file read ${reading.path} error ${err.message}`)
        res.statusCode = 500
        res.end()
    })
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

function errorExit(msg: string): never {
    console.log(`\u001b[31merror:\u001b[0m`, msg)
    process.exit(1)
}
