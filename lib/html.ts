import EventEmitter from 'node:events'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { extname } from 'node:path/posix'
import {
    defaultTreeAdapter,
    type DefaultTreeAdapterTypes,
    parse,
    parseFragment,
    serialize,
} from 'parse5'
import type { EntryPoint } from './esbuild.ts'
import type { DankBuild } from './flags.ts'

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
    fsPath: string
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

export type HtmlDecoration = {
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
    // Dispatched from HtmlEntrypoint to notify when new HtmlEntrypoint.#document output is ready for write
    // Parameter `html` is the updated html content of the page ready to be output to the build dir
    output: [html: string]
    // Dispatched from HtmlEntrypoint to notify `dank serve` of a partial dependency for an HtmlEntrypoint
    // Seemingly a duplicate of event `partials` but it keeps relevant state in sync during async io
    // Parameter `partial` is the fs path to the partial
    partial: [partial: string]
    // Dispatched from HtmlEntrypoint to notify `dank serve` of completely resolved imported partials
    // Parameter `partials` are the fs paths to the partials
    partials: [partials: Array<string>]
}

export class HtmlEntrypoint extends EventEmitter<HtmlEntrypointEvents> {
    #build: DankBuild
    #decorations?: Array<HtmlDecoration>
    #document: Document = defaultTreeAdapter.createDocument()
    // todo cache entrypoints set for quicker diffing
    // #entrypoints: Set<string> = new Set()
    #fsPath: string
    #partials: Array<PartialContent> = []
    #scripts: Array<ImportedScript> = []
    #update: Object = Object()
    #url: string

    constructor(
        build: DankBuild,
        url: string,
        fsPath: string,
        decorations?: Array<HtmlDecoration>,
    ) {
        super({ captureRejections: true })
        this.#build = build
        this.#decorations = decorations
        this.#url = url
        this.#fsPath = fsPath
        this.on('change', this.#onChange)
        this.emit('change')
    }

    get fsPath(): string {
        return this.#fsPath
    }

    get url(): string {
        return this.#url
    }

    async #html(): Promise<string> {
        try {
            return await readFile(
                join(this.#build.dirs.pages, this.#fsPath),
                'utf8',
            )
        } catch (e) {
            // todo error handling
            errorExit(this.#fsPath + ' does not exist')
        }
    }

    // todo if partial changes, hot swap content in page
    #onChange = async (_partial?: string) => {
        const update = (this.#update = Object())
        const html = await this.#html()
        const document = parse(html)
        const imports: CollectedImports = {
            partials: [],
            scripts: [],
        }
        this.#collectImports(document, imports)
        const partials = await this.#resolvePartialContent(imports.partials)
        if (update !== this.#update) {
            // another update has started so aborting this one
            return
        }
        this.#addDecorations(document)
        this.#update = update
        this.#document = document
        this.#partials = partials
        this.#scripts = imports.scripts
        const entrypoints = mergeEntrypoints(
            imports,
            ...partials.map(p => p.imports),
        )
        // this.#entrypoints = new Set(entrypoints.map(entrypoint => entrypoint.in))
        this.emit('entrypoints', entrypoints)
        this.emit(
            'partials',
            this.#partials.map(p => p.fsPath),
        )
        if (this.listenerCount('output')) {
            this.emit('output', this.output())
        }
    }

    // Emits `partial` on detecting a partial reference for `dank serve` file watches
    // to respond to dependent changes
    // todo safeguard recursive partials that cause circular imports
    async #resolvePartialContent(
        partials: Array<PartialReference>,
    ): Promise<Array<PartialContent>> {
        return await Promise.all(
            partials.map(async p => {
                this.emit('partial', p.fsPath)
                const html = await readFile(
                    join(this.#build.dirs.pages, p.fsPath),
                    'utf8',
                )
                const fragment = parseFragment(html)
                const imports: CollectedImports = {
                    partials: [],
                    scripts: [],
                }
                this.#collectImports(fragment, imports, node => {
                    this.#rewritePartialRelativePaths(node, p.fsPath)
                })
                if (imports.partials.length) {
                    // todo recursive partials?
                    // await this.#resolvePartialContent(imports.partials)
                    errorExit(
                        `partial ${p.fsPath} cannot recursively import partials`,
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

    #addDecorations(document: Document) {
        if (!this.#decorations?.length) {
            return
        }
        for (const decoration of this.#decorations) {
            switch (decoration.type) {
                case 'script':
                    const scriptNode = parseFragment(
                        `<script type="module">${decoration.js}</script>`,
                    ).childNodes[0]
                    const htmlNode = document.childNodes.find(
                        node => node.nodeName === 'html',
                    ) as ParentNode
                    const headNode = htmlNode.childNodes.find(
                        node => node.nodeName === 'head',
                    ) as ParentNode | undefined
                    defaultTreeAdapter.appendChild(
                        headNode || htmlNode,
                        scriptNode,
                    )
                    break
            }
        }
    }

    output(hrefs?: HtmlHrefs): string {
        this.#injectPartials()
        this.#rewriteHrefs(hrefs)
        return serialize(this.#document)
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
            if (!this.#build.production) {
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
            if (this.#build.production) {
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
                    const pp = partialMatch.groups!.pp.trim()
                    if (pp.startsWith('/')) {
                        errorExit(
                            `partial ${pp} in webpage ${this.#fsPath} cannot be an absolute path`,
                        )
                    }
                    if (!isPagesSubpathInPagesDir(this.#build, pp)) {
                        errorExit(
                            `partial ${pp} in webpage ${this.#fsPath} cannot be outside of the pages directory`,
                        )
                    }
                    collection.partials.push({
                        fsPath: pp.replace(/^\.\//, ''),
                        commentNode: childNode,
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
        const inPath = join(this.#build.dirs.pages, dirname(this.#fsPath), href)
        if (!isPathInPagesDir(this.#build, inPath)) {
            errorExit(
                `href ${href} in webpage ${this.#fsPath} cannot reference sources outside of the pages directory`,
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

// check if relative dir is a subpath of pages dir when joined with pages dir
// used if the joined pages dir path is only used for the pages dir check
function isPagesSubpathInPagesDir(build: DankBuild, subpath: string): boolean {
    return isPathInPagesDir(build, join(build.dirs.pages, subpath))
}

// check if subpath joined with pages dir is a subpath of pages dir
function isPathInPagesDir(build: DankBuild, p: string): boolean {
    return resolve(p).startsWith(build.dirs.pagesResolved)
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

function errorExit(msg: string): never {
    console.log(`\u001b[31merror:\u001b[0m`, msg)
    process.exit(1)
}
