import { createReadStream, ReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import {
    createServer,
    type IncomingHttpHeaders,
    type IncomingMessage,
    type OutgoingHttpHeaders,
    type ServerResponse,
} from 'node:http'
import { join } from 'node:path'
import mime from 'mime'
import type { ResolvedDankConfig } from './config.ts'
import { isDankDevApiUrl } from './dev_api.ts'
import { DankDevApi } from './dev_backend.ts'
import type { DankDirectories } from './dirs.ts'
import type { DevServices } from './services.ts'

type ReqHandler = (
    url: URL,
    req: IncomingMessage,
) => Promise<Response | ReadStream | null | undefined>

class ReqHandlerSequence {
    #handlers: Array<ReqHandler>
    constructor(handlers: Array<ReqHandler>) {
        this.#handlers = handlers
    }

    async handle(
        url: URL,
        req: IncomingMessage,
        res: ServerResponse,
    ): Promise<void> {
        let handler = 0
        const next = async () => {
            if (handler >= this.#handlers.length) return
            let result: Awaited<ReturnType<ReqHandler>>
            try {
                result = await this.#handlers[handler++](url, req)
            } catch (e) {
                console.error('error during http request handler:', e)
                res.writeHead(500)
                return
            }
            if (!result) {
                await next()
            } else if (result instanceof ReadStream) {
                await streamFile(result, res)
            } else if (result instanceof Response) {
                res.writeHead(
                    result.status,
                    convertHeadersFromFetch(result.headers),
                )
                res.write(await result.bytes())
            } else {
                throw TypeError()
            }
        }
        try {
            await next()
        } finally {
            if (!res.headersSent) {
                res.writeHead(404)
            }
            res.end()
        }
    }
}

export type DevServerState = {
    htmlFiles?: InMemoryHtmlFiles
    devServices?: DevServices
}

export type InMemoryHtmlFiles = (url: `/${string}`) => string | null

export function startWebServer(
    c: ResolvedDankConfig,
    devState?: DevServerState,
) {
    const serverAddress = 'http://localhost:' + c.dankPort
    const handlers: Array<ReqHandler> = []
    const handlerSequence = new ReqHandlerSequence(handlers)

    if (c.useDankDevUI()) {
        handlers.push(createDankDevApiHandler(c))
    }

    if (devState?.htmlFiles) {
        handlers.push(createInMemoryHtmlFilesHandler(devState.htmlFiles))
    }

    if (c.isPreviewMode()) {
        handlers.push(createPreviewDistStaticHandler(c.dirs))
    } else {
        handlers.push(createDevPublicDirHandler(c.dirs))
        handlers.push(createDevEsbuildProxyHandler(c))
    }

    if (c.isPreviewMode()) {
        handlers.push(createUrlRewriteHandler(c, createDistHtmlFileReader(c)))
    } else if (devState?.htmlFiles) {
        handlers.push(
            createUrlRewriteHandler(
                c,
                createInMemoryHtmlDelegate(devState.htmlFiles),
            ),
        )
    } else {
        throw TypeError()
    }

    if (devState?.devServices) {
        handlers.push(createDevHttpServicesHandler(devState.devServices))
    }

    const listener = (req: IncomingMessage, res: ServerResponse) => {
        if (req.url && req.method) {
            handlerSequence.handle(new URL(serverAddress + req.url), req, res)
        }
    }
    createServer(
        c.flags.logHttp ? createLogListener(listener) : listener,
    ).listen(c.dankPort)
    console.log(
        c.isPreviewMode() ? 'preview' : 'dev',
        `server is live at http://127.0.0.1:${c.dankPort}`,
    )
}

function createLogListener(
    listener: (req: IncomingMessage, res: ServerResponse) => void,
) {
    return (req: IncomingMessage, res: ServerResponse) => {
        if (req.url && req.method) {
            console.log('  > ', req.method, req.url)
            listener(req, res)
            console.log('', res.statusCode, req.method, req.url)
        }
    }
}

function isGetRequest(req: IncomingMessage): boolean {
    return req.method === 'GET'
}

function isHtmlRequest(req: IncomingMessage): boolean {
    return req.headers.accept?.includes('text/html') ?? false
}

function createDevPublicDirHandler(dirs: DankDirectories): ReqHandler {
    return async (url, req) => {
        if (isGetRequest(req)) {
            const maybePublicPath = join(
                dirs.projectRootAbs,
                dirs.public,
                url.pathname,
            )
            const isFromPublic = await exists(maybePublicPath)
            if (isFromPublic) {
                return createReadStream(maybePublicPath)
            }
        }
    }
}

function createDevEsbuildProxyHandler(c: ResolvedDankConfig): ReqHandler {
    return async (url, req) => {
        if (isGetRequest(req) && !isHtmlRequest(req)) {
            const proxyAddress = 'http://localhost:' + c.esbuildPort
            try {
                const fetchRes = await retryFetchWithTimeout(
                    proxyAddress + url.pathname,
                )
                if (fetchRes.status === 404) {
                    return
                } else {
                    return fetchRes
                }
            } catch (e: any) {
                if (isFetchRetryTimeout(e)) {
                    return new Response(null, { status: 504 })
                } else {
                    console.error('error proxying to esbuild:', e.message)
                    return new Response(null, { status: 502 })
                }
            }
        }
    }
}

function createPreviewDistStaticHandler(dirs: DankDirectories): ReqHandler {
    const buildDistAbs = join(dirs.projectRootAbs, dirs.buildDist)
    return async (url, req) => {
        if (isGetRequest(req)) {
            if (isHtmlRequest(req)) {
                const maybeHtmlPath = join(
                    buildDistAbs,
                    url.pathname,
                    'index.html',
                )
                if (await exists(maybeHtmlPath)) {
                    return createReadStream(
                        join(buildDistAbs, url.pathname, 'index.html'),
                    )
                }
            } else {
                const maybePath = join(buildDistAbs, url.pathname)
                if (await exists(maybePath)) {
                    return createReadStream(maybePath)
                }
            }
        }
    }
}

function createInMemoryHtmlFilesHandler(
    htmlFiles: InMemoryHtmlFiles,
): ReqHandler {
    return async (url, req) => {
        if (isGetRequest(req) && isHtmlRequest(req)) {
            const html = htmlFiles(url.pathname as `/${string}`)
            if (html) {
                return new Response(html, {
                    headers: { 'content-type': 'text/html' },
                })
            }
        }
    }
}

type HtmlFilesDelegate = (path: `/${string}`) => ReadStream | Response | null

function createInMemoryHtmlDelegate(
    htmlFiles: InMemoryHtmlFiles,
): HtmlFilesDelegate {
    return (url: `/${string}`) => {
        console.log(url, 'not html?')
        const html = htmlFiles(url)
        if (html) {
            console.log('HTML')
            return new Response(html, {
                headers: { 'Content-Type': 'text/html' },
            })
        } else {
            return null
        }
    }
}

function createDistHtmlFileReader(c: ResolvedDankConfig): HtmlFilesDelegate {
    return (path: `/${string}`) => {
        if (c.pageUrls.includes(path)) {
            return createReadStream(
                join(
                    c.dirs.projectRootAbs,
                    c.dirs.buildDist,
                    path,
                    'index.html',
                ),
            )
        } else {
            return null
        }
    }
}

function createUrlRewriteHandler(
    c: ResolvedDankConfig,
    htmlFiles: HtmlFilesDelegate,
): ReqHandler {
    return async (url, req) => {
        if (isGetRequest(req) && isHtmlRequest(req)) {
            const urlRewrite = c.urlRewrites?.find(urlRewrite =>
                urlRewrite.pattern.test(url.pathname),
            )
            if (urlRewrite) {
                return htmlFiles(urlRewrite.url)
            }
        }
    }
}

function createDankDevApiHandler(c: ResolvedDankConfig): ReqHandler {
    const dankDevApi = new DankDevApi(c)
    return async (url, req) => {
        if (isDankDevApiUrl(url)) {
            return await invokeDankDevApiMethod(req, dankDevApi)
        }
    }
}

function createDevHttpServicesHandler(devServices: DevServices): ReqHandler {
    return async (url, req) => {
        return await tryHttpServices(
            req,
            url,
            convertHeadersToFetch(req.headers),
            devServices,
        )
    }
}

async function invokeDankDevApiMethod(
    req: IncomingMessage,
    api: DankDevApi,
): Promise<Response> {
    if (req.method !== 'POST') {
        return new Response(null, { status: 405 })
    } else if (!req.headers['content-type']?.startsWith('application/json')) {
        return new Response(null, { status: 400 })
    } else {
        try {
            const apiReq = await collectReqBody(req)
            if (apiReq === null) {
                return new Response(null, { status: 400 })
            } else {
                const apiRes = await api.invokeReq(JSON.parse(apiReq))
                return Response.json(apiRes)
            }
        } catch (e) {
            console.error('error during dank dev api: ' + (e as any).message)
            return new Response(null, { status: 500 })
        }
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
                return new Response(null, { status: 502 })
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
    } catch {
        return false
    }
}

function streamFile(
    readStream: ReadStream,
    res: ServerResponse,
): Promise<void> {
    const p =
        typeof readStream.path === 'string'
            ? readStream.path
            : readStream.path.toString('utf8')
    const contentType = mime.getType(p) || 'application/octet-stream'
    res.setHeader('Content-Type', contentType)
    readStream.pipe(res)
    return new Promise((res, rej) => {
        readStream.on('end', res)
        readStream.on('error', rej)
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
