import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import {
    createServer,
    type IncomingHttpHeaders,
    type IncomingMessage,
    type OutgoingHttpHeaders,
    type ServerResponse,
} from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import mime from 'mime'
import type { ResolvedDankConfig } from './config.ts'
import type { WebsiteManifest } from './dank.ts'
import type { DankDirectories } from './dirs.ts'
import type { UrlRewrite, WebsiteRegistry } from './registry.ts'
import type { DevServices } from './services.ts'

export type UrlRewriteProvider = {
    urlRewrites: Array<UrlRewrite>
}

export type FrontendFetcher = (
    url: URL,
    headers: Headers,
    res: ServerResponse,
    notFound: () => void,
) => void

export type HtmlFileFetcher = (url: `/${string}`) => Promise<string | null>

export function startWebServer(
    c: ResolvedDankConfig,
    urlRewriteProvider: UrlRewriteProvider,
    frontendFetcher: FrontendFetcher,
    htmlFileFetcher: HtmlFileFetcher,
    devServices: DevServices,
) {
    const serverAddress = 'http://localhost:' + c.dankPort
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
                    devServices,
                    urlRewriteProvider,
                    htmlFileFetcher,
                    res,
                ),
            )
        }
    }
    createServer(c.flags.logHttp ? createLogWrapper(handler) : handler).listen(
        c.dankPort,
    )
    console.log(
        c.isPreviewMode() ? 'preview' : 'dev',
        `server is live at http://127.0.0.1:${c.dankPort}`,
    )
}

async function onNotFound(
    req: IncomingMessage,
    url: URL,
    headers: Headers,
    devServices: DevServices,
    urlRewriteProvider: UrlRewriteProvider,
    htmlFileFetcher: HtmlFileFetcher,
    res: ServerResponse,
) {
    if (req.method === 'GET') {
        const urlRewrite = urlRewriteProvider.urlRewrites.find(urlRewrite =>
            urlRewrite.pattern.test(url.pathname),
        )
        if (urlRewrite) {
            sendHtml(res, await htmlFileFetcher(urlRewrite.url))
            return
        }
    }
    const fetchResponse = await tryHttpServices(req, url, headers, devServices)
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

async function tryHttpServices(
    req: IncomingMessage,
    url: URL,
    headers: Headers,
    devServices: DevServices,
): Promise<Response | null> {
    if (url.pathname.startsWith('/.well-known/')) {
        return null
    }
    const body = await collectReqBody(req)
    for (const httpService of devServices.httpServices) {
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

// `dank preview` uses HtmlFileFetcher for serving index.html from a url rewrite
// other index.html requests will be handled by FrontendFetcher and streamFile
export function createBuiltDistHtmlFileFetcher(
    dirs: DankDirectories,
    manifest: WebsiteManifest,
): HtmlFileFetcher {
    return async url =>
        manifest.pageUrls.includes(url)
            ? await readFile(
                  join(dirs.projectRootAbs, dirs.buildDist, url, 'index.html'),
                  'utf8',
              )
            : null
}

export function createBuiltDistFilesFetcher(
    dirs: DankDirectories,
    manifest: WebsiteManifest,
): FrontendFetcher {
    return (
        url: URL,
        _headers: Headers,
        res: ServerResponse,
        notFound: () => void,
    ) => {
        if (manifest.pageUrls.includes(url.pathname as `/${string}`)) {
            streamFile(
                join(
                    dirs.projectRootAbs,
                    dirs.buildDist,
                    url.pathname,
                    'index.html',
                ),
                res,
            )
        } else if (manifest.files.includes(url.pathname as `/${string}`)) {
            streamFile(
                join(dirs.projectRootAbs, dirs.buildDist, url.pathname),
                res,
            )
        } else {
            notFound()
        }
    }
}

export function createDevServeFilesFetcher(
    esbuildPort: number,
    dirs: DankDirectories,
    registry: WebsiteRegistry,
    htmlFileFetcher: HtmlFileFetcher,
): FrontendFetcher {
    const proxyAddress = 'http://127.0.0.1:' + esbuildPort
    return (
        url: URL,
        _headers: Headers,
        res: ServerResponse,
        notFound: () => void,
    ) => {
        if (registry.pageUrls.includes(url.pathname as `/${string}`)) {
            htmlFileFetcher(url.pathname as `/${string}`).then(html =>
                sendHtml(res, html),
            )
        } else {
            const maybePublicPath = join(dirs.public, url.pathname)
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

function sendHtml(res: ServerResponse, html: string | null) {
    if (html) {
        res.appendHeader('content-type', 'text/html')
        res.write(html)
    } else {
        res.writeHead(404)
    }
    res.end()
}

function errorExit(msg: string): never {
    console.log(`\u001b[31merror:\u001b[0m`, msg)
    process.exit(1)
}
