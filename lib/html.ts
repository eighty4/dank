import EventEmitter from 'node:events'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { extname } from 'node:path/posix'
import {
    defaultTreeAdapter,
    type DefaultTreeAdapterTypes,
    parse,
    parseFragment,
    serialize,
} from 'parse5'
import type { ResolvedDankConfig } from './config.ts'
import { LOG } from './developer.ts'
import type { Resolver } from './dirs.ts'
import { DankError } from './errors.ts'
import type { EntryPoint } from './esbuild.ts'

type CommentNode = DefaultTreeAdapterTypes.CommentNode
type Document = DefaultTreeAdapterTypes.Document
type DocumentFragment = DefaultTreeAdapterTypes.DocumentFragment
type Element = DefaultTreeAdapterTypes.Element
type ParentNode = DefaultTreeAdapterTypes.ParentNode

type CollectedImports = {
    partials: Array<PartialReference>
    scripts: Array<ImportedScript>
}

type PartialReference = {
    commentNode: CommentNode
    // path within pages dir omitting pages/ segment
    fsPath: string
    // unresolved partial path read from commentNode text
    specifier: string
}

type PartialContent = PartialReference & {
    fragment: DocumentFragment
    imports: CollectedImports
    // todo recursive partials?
    // partials: Array<PartialContent>
}

type ImportedScript = {
    type: 'script' | 'style'
    href: string
    elem: Element
    entrypoint: EntryPoint
}

type HtmlDecoration = {
    type: 'script'
    js: string
}

// implicitly impl'd by WebsiteRegistry
export type HtmlHrefs = {
    mappedHref(lookup: string): string
}

export type HtmlEntrypointEvents = {
    // Dispatched from fs watch to notify HtmlEntrypoint of changes to HtmlEntrypoint.#fsPath
    // Optional parameter `partial` notifies the page when a partial of the page has changed
    change: [partial?: string]
    // Dispatched from HtmlEntrypoint to notify `dank serve` of changes to esbuild entrypoints
    // Parameter `entrypoints` is the esbuild mappings of the input and output paths
    entrypoints: [entrypoints: Array<EntryPoint>]
    // Dispatched from HtmlEntrypoint when processing HTML is aborted on error
    error: [e: Error]
    // Dispatched from HtmlEntrypoint to notify when new HtmlEntrypoint.#document output is ready for write
    // Parameter `html` is the updated html content of the page ready to be output to the build dir
    output: [html: string]
}

export class HtmlEntrypoint extends EventEmitter<HtmlEntrypointEvents> {
    #c: ResolvedDankConfig
    #clientJS: ClientJS | null
    #document: Document = defaultTreeAdapter.createDocument()
    #entrypoints: Set<string> = new Set()
    // path within pages dir omitting pages/ segment
    #fsPath: string
    #partials: Array<PartialContent> = []
    #resolver: Resolver
    #scripts: Array<ImportedScript> = []
    #update: Object = Object()
    #url: `/${string}`

    constructor(
        c: ResolvedDankConfig,
        resolver: Resolver,
        url: `/${string}`,
        fsPath: string,
    ) {
        super({ captureRejections: true })
        this.#c = c
        this.#clientJS = ClientJS.initialize(c)
        this.#resolver = resolver
        this.#url = url
        this.#fsPath = fsPath
        this.on('change', this.#onChange)
    }

    get fsPath(): string {
        return this.#fsPath
    }

    get url(): `/${string}` {
        return this.#url
    }

    async process() {
        await this.#onChange()
    }

    output(hrefs?: HtmlHrefs): string {
        this.#injectPartials()
        this.#rewriteHrefs(hrefs)
        return serialize(this.#document)
    }

    usesPartial(fsPath: string): boolean {
        return this.#partials.some(partial => partial.fsPath === fsPath)
    }

    #onChange = async () => {
        const update = (this.#update = Object())
        let html: string
        try {
            html = await this.#readFromPages(this.#fsPath)
        } catch (e) {
            this.#error(
                `url \`${this.#url}\` html file \`${join(this.#c.dirs.pages, this.#fsPath)}\` does not exist`,
            )
            return
        }
        const document = parse(html)
        const imports: CollectedImports = {
            partials: [],
            scripts: [],
        }
        let partials: Array<PartialContent>
        this.#collectImports(document, imports)
        const partialResults = await this.#resolvePartialContent(
            imports.partials,
        )
        partials = partialResults.filter(p => p !== false)
        // `dank serve` will not throw an error during a partial error, so this emits error and breaks out of `change` event handler
        if (partials.length !== partialResults.length) {
            this.#error(
                `update to \`${join(this.#c.dirs.pages, this.#fsPath)}\` did not update to \`${this.#url}\` because of unresolved partials`,
            )
            return
        }
        if (this.#clientJS !== null) {
            const decoration = await this.#clientJS.retrieve(
                this.#c.esbuildPort,
            )
            this.#addScriptDecoration(document, decoration.js)
        }
        if (update !== this.#update) {
            // another update has started so aborting this one
            // only do synchronous work after this check
            return
        }
        this.#document = document
        this.#partials = partials
        this.#scripts = imports.scripts
        const entrypoints = mergeEntrypoints(
            imports,
            ...partials.map(p => p.imports),
        )
        LOG({
            realm: 'html',
            message: 'processed html entrypoint',
            data: {
                url: this.#url,
                html: this.#fsPath,
                entrypoints: entrypoints.map(ep => ep.in),
                partials: partials.map(p => p.fsPath),
            },
        })
        if (this.#haveEntrypointsChanged(entrypoints)) {
            this.emit('entrypoints', entrypoints)
        }
        if (this.listenerCount('output')) {
            this.emit('output', this.output())
        }
    }

    #error(e: DankError | Error | string) {
        let message: string
        let error: Error
        if (typeof e === 'string') {
            message = e
            error = new DankError(e)
        } else {
            message = e.message
            error = e
        }
        LOG({
            realm: 'html',
            message: 'error processing html',
            data: {
                url: this.#url,
                html: this.#fsPath,
                error: message,
            },
        })
        if (this.listenerCount('error')) {
            this.emit('error', error)
        } else {
            throw error
        }
    }

    #haveEntrypointsChanged(entrypoints: Array<EntryPoint>) {
        const set = new Set(entrypoints.map(entrypoint => entrypoint.in))
        const changed = set.symmetricDifference(this.#entrypoints).size > 0
        this.#entrypoints = set
        return changed
    }

    async #readFromPages(p: string): Promise<string> {
        return await readFile(this.#resolver.absPagesPath(p), 'utf8')
    }

    async #resolvePartialContent(
        partials: Array<PartialReference>,
    ): Promise<Array<PartialContent | false>> {
        return await Promise.all(
            partials.map(async p => {
                let html: string
                if (isAbsolute(p.specifier)) {
                    this.#error(
                        `partials cannot be referenced with an absolute path like \`${p.specifier}\` in webpage \`${join(this.#c.dirs.pages, this.#fsPath)}\``,
                    )
                    return false
                }
                if (!this.#resolver.isPagesSubpathInPagesDir(p.fsPath)) {
                    this.#error(
                        `partials cannot be referenced from outside the pages dir like \`${p.specifier}\` in webpage \`${join(this.#c.dirs.pages, this.#fsPath)}\``,
                    )
                    return false
                }
                if (extname(p.fsPath) !== '.html') {
                    this.#error(
                        `partial path \`${p.fsPath}\` referenced by \`${this.#fsPath}\` is not a valid partial path`,
                    )
                    return false
                }
                try {
                    html = await this.#readFromPages(p.fsPath)
                } catch (e) {
                    this.#error(
                        `partial \`${join('pages', p.fsPath)}\` imported by \`${join('pages', this.#fsPath)}\` does not exist`,
                    )
                    return false
                }
                const fragment = parseFragment(html)
                const imports: CollectedImports = {
                    partials: [],
                    scripts: [],
                }
                this.#collectImports(fragment, imports, node => {
                    this.#rewritePartialRelativePaths(node, p.fsPath)
                })
                if (imports.partials.length) {
                    this.#error(
                        `partials cannot import another partial like \`${join(this.#c.dirs.pages, p.fsPath)}\``,
                    )
                }
                const content: PartialContent = {
                    ...p,
                    fragment,
                    imports,
                }
                return content
            }),
        )
    }

    // rewrite hrefs in a partial to be relative to the html entrypoint instead of the partial
    #rewritePartialRelativePaths(elem: Element, partialPath: string) {
        let rewritePath: 'src' | 'href' | null = null
        if (elem.nodeName === 'script') {
            rewritePath = 'src'
        } else if (
            elem.nodeName === 'link' &&
            hasAttr(elem, 'rel', 'stylesheet')
        ) {
            rewritePath = 'href'
        }
        if (rewritePath !== null) {
            const attr = getAttr(elem, rewritePath)
            if (attr) {
                attr.value = join(
                    relative(dirname(this.#fsPath), dirname(partialPath)),
                    attr.value,
                )
            }
        }
    }

    #addScriptDecoration(document: Document, js: string) {
        const scriptNode = parseFragment(`<script type="module">${js}</script>`)
            .childNodes[0]
        const htmlNode = document.childNodes.find(
            node => node.nodeName === 'html',
        ) as ParentNode
        const headNode = htmlNode.childNodes.find(
            node => node.nodeName === 'head',
        ) as ParentNode | undefined
        defaultTreeAdapter.appendChild(headNode || htmlNode, scriptNode)
    }

    // rewrites hrefs to content hashed urls
    // call without hrefs to rewrite tsx? ext to js
    #rewriteHrefs(hrefs?: HtmlHrefs) {
        rewriteHrefs(this.#scripts, hrefs)
        for (const partial of this.#partials) {
            rewriteHrefs(partial.imports.scripts, hrefs)
        }
    }

    async #injectPartials() {
        for (const { commentNode, fragment } of this.#partials) {
            if (!this.#c.flags.production) {
                defaultTreeAdapter.insertBefore(
                    commentNode.parentNode!,
                    defaultTreeAdapter.createCommentNode(commentNode.data),
                    commentNode,
                )
            }
            for (const node of fragment.childNodes) {
                defaultTreeAdapter.insertBefore(
                    commentNode.parentNode!,
                    node,
                    commentNode,
                )
            }
            if (this.#c.flags.production) {
                defaultTreeAdapter.detachNode(commentNode)
            }
        }
    }

    #collectImports(
        node: ParentNode,
        collection: CollectedImports,
        forEach?: (elem: Element) => void,
    ) {
        for (const childNode of node.childNodes) {
            if (forEach && 'tagName' in childNode) {
                forEach(childNode)
            }
            if (childNode.nodeName === '#comment' && 'data' in childNode) {
                const partialMatch = childNode.data.match(/\{\{(?<pp>.+)\}\}/)
                if (partialMatch) {
                    const specifier = partialMatch.groups!.pp.trim()
                    collection.partials.push({
                        commentNode: childNode,
                        fsPath: join(dirname(this.#fsPath), specifier),
                        specifier: specifier,
                    })
                }
            } else if (childNode.nodeName === 'script') {
                const srcAttr = childNode.attrs.find(
                    attr => attr.name === 'src',
                )
                if (srcAttr) {
                    collection.scripts.push(
                        this.#parseImport('script', srcAttr.value, childNode),
                    )
                }
            } else if (
                childNode.nodeName === 'link' &&
                hasAttr(childNode, 'rel', 'stylesheet')
            ) {
                const hrefAttr = getAttr(childNode, 'href')
                if (hrefAttr) {
                    collection.scripts.push(
                        this.#parseImport('style', hrefAttr.value, childNode),
                    )
                }
            } else if ('childNodes' in childNode) {
                this.#collectImports(childNode, collection)
            }
        }
    }

    #parseImport(
        type: ImportedScript['type'],
        href: string,
        elem: Element,
    ): ImportedScript {
        const inPath = join(this.#c.dirs.pages, dirname(this.#fsPath), href)
        if (!this.#resolver.isProjectSubpathInPagesDir(inPath)) {
            throw new DankError(
                `href \`${href}\` in webpage \`${join(this.#c.dirs.pages, this.#fsPath)}\` cannot reference sources outside of the pages directory`,
            )
        }
        let outPath = join(dirname(this.#fsPath), href)
        if (type === 'script' && !outPath.endsWith('.js')) {
            outPath = outPath.replace(
                new RegExp(extname(outPath).substring(1) + '$'),
                'js',
            )
        }
        return {
            type,
            href,
            elem,
            entrypoint: {
                in: inPath,
                out: outPath,
            },
        }
    }
}

function getAttr(elem: Element, name: string) {
    return elem.attrs.find(attr => attr.name === name)
}

function hasAttr(elem: Element, name: string, value: string): boolean {
    return elem.attrs.some(attr => attr.name === name && attr.value === value)
}

function mergeEntrypoints(
    ...imports: Array<CollectedImports>
): Array<EntryPoint> {
    const entrypoints: Array<EntryPoint> = []
    for (const { scripts } of imports) {
        for (const script of scripts) {
            entrypoints.push(script.entrypoint)
        }
    }
    return entrypoints
}

function rewriteHrefs(scripts: Array<ImportedScript>, hrefs?: HtmlHrefs) {
    for (const { elem, entrypoint, type } of scripts) {
        const rewriteTo = hrefs ? hrefs.mappedHref(entrypoint.in) : null
        if (type === 'script') {
            if (
                entrypoint.in.endsWith('.tsx') ||
                entrypoint.in.endsWith('.ts')
            ) {
                elem.attrs.find(attr => attr.name === 'src')!.value =
                    rewriteTo || `/${entrypoint.out}`
            }
        } else if (type === 'style') {
            elem.attrs.find(attr => attr.name === 'href')!.value =
                rewriteTo || `/${entrypoint.out}`
        }
    }
}

class ClientJS {
    static #instance: ClientJS | null = null

    static initialize(c: ResolvedDankConfig): ClientJS | null {
        if (c.mode === 'build' || c.flags.preview) {
            return null
        } else if (!ClientJS.#instance) {
            ClientJS.#instance = new ClientJS(c.esbuildPort)
        }
        return ClientJS.#instance
    }

    #esbuildPort: number
    #read: Promise<string>
    #result: Promise<HtmlDecoration>

    private constructor(esbuildPort: number) {
        this.#esbuildPort = esbuildPort
        this.#read = readFile(
            resolve(import.meta.dirname, join('..', 'client', 'client.js')),
            'utf-8',
        )
        this.#result = this.#read.then(this.#transform)
    }

    async retrieve(esbuildPort: number): Promise<HtmlDecoration> {
        if (esbuildPort !== this.#esbuildPort) {
            this.#result = this.#read.then(this.#transform)
        }
        return await this.#result
    }

    #transform = (js: string): HtmlDecoration => {
        return {
            type: 'script',
            js: js.replace('3995', '' + this.#esbuildPort),
        }
    }
}
