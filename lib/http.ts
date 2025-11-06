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
import type { WebsiteManifest } from './metadata.ts'
import type { HttpServices } from './services.ts'

export type FrontendFetcher = (
    url: URL,
    headers: Headers,
    res: ServerResponse,
    notFound: () => void,
) => void

// state needed to eval url rewriting after FrontendFetcher and before HttpServices
export type PageRouteState = {
    // urls of html entrypoints
    urls: Array<string>
    urlRewrites: Array<UrlRewrite>
}

export type UrlRewrite = {
    pattern: RegExp
    url: string
}

export function startWebServer(
    serve: DankServe,
    frontendFetcher: FrontendFetcher,
    httpServices: HttpServices,
    pageRoutes: PageRouteState,
) {
    const serverAddress = 'http://localhost:' + serve.dankPort
    const handler = (req: IncomingMessage, res: ServerResponse) => {
        if (!req.url || !req.method) {
            res.end()
        } else {
            const url = new URL(serverAddress + req.url)
            const headers = convertHeadersToFetch(req.headers)
            frontendFetcher(url, headers, res, () =>
                onNotFound(
                    req,
                    url,
                    headers,
                    httpServices,
                    pageRoutes,
                    serve,
                    res,
                ),
            )
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

async function onNotFound(
    req: IncomingMessage,
    url: URL,
    headers: Headers,
    httpServices: HttpServices,
    pageRoutes: PageRouteState,
    serve: DankServe,
    res: ServerResponse,
) {
    if (req.method === 'GET' && extname(url.pathname) === '') {
        const urlRewrite = tryUrlRewrites(url, pageRoutes, serve)
        if (urlRewrite) {
            streamFile(urlRewrite, res)
            return
        }
    }
    const fetchResponse = await tryHttpServices(req, url, headers, httpServices)
    if (fetchResponse) {
        sendFetchResponse(res, fetchResponse)
    } else {
        res.writeHead(404)
        res.end()
    }
}

async function sendFetchResponse(res: ServerResponse, fetchResponse: Response) {
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

function tryUrlRewrites(
    url: URL,
    pageRoutes: PageRouteState,
    serve: DankServe,
): string | null {
    const urlRewrite = pageRoutes.urlRewrites.find(urlRewrite =>
        urlRewrite.pattern.test(url.pathname),
    )
    return urlRewrite
        ? join(serve.dirs.buildWatch, urlRewrite.url, 'index.html')
        : null
}

async function tryHttpServices(
    req: IncomingMessage,
    url: URL,
    headers: Headers,
    httpServices: HttpServices,
): Promise<Response | null> {
    if (url.pathname.startsWith('/.well-known/')) {
        return null
    }
    const body = await collectReqBody(req)
    const { running } = httpServices
    for (const httpService of running) {
        const proxyUrl = new URL(url)
        proxyUrl.port = `${httpService.port}`
        try {
            const response = await retryFetchWithTimeout(proxyUrl, {
                body,
                headers,
                method: req.method,
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

function collectReqBody(req: IncomingMessage): Promise<string | null> {
    let body = ''
    req.on('data', data => (body += data.toString()))
    return new Promise(res =>
        req.on('end', () => res(body.length ? body : null)),
    )
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
    manifest: WebsiteManifest,
): FrontendFetcher {
    return (
        url: URL,
        _headers: Headers,
        res: ServerResponse,
        notFound: () => void,
    ) => {
        if (manifest.pageUrls.has(url.pathname)) {
            streamFile(join(dir, url.pathname, 'index.html'), res)
        } else if (manifest.files.has(url.pathname)) {
            streamFile(join(dir, url.pathname), res)
        } else {
            notFound()
        }
    }
}

// todo replace PageRouteState with WebsiteRegistry
export function createDevServeFilesFetcher(
    pageRoutes: PageRouteState,
    serve: DankServe,
): FrontendFetcher {
    const proxyAddress = 'http://127.0.0.1:' + serve.esbuildPort
    return (
        url: URL,
        _headers: Headers,
        res: ServerResponse,
        notFound: () => void,
    ) => {
        if (pageRoutes.urls.includes(url.pathname)) {
            streamFile(
                join(serve.dirs.buildWatch, url.pathname, 'index.html'),
                res,
            )
        } else {
            const maybePublicPath = join(serve.dirs.public, url.pathname)
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
