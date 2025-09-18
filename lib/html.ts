import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import {
    defaultTreeAdapter,
    type DefaultTreeAdapterTypes,
    parse,
    parseFragment,
    serialize,
} from 'parse5'

type CommentNode = DefaultTreeAdapterTypes.CommentNode
type Document = DefaultTreeAdapterTypes.Document
type Element = DefaultTreeAdapterTypes.Element
type ParentNode = DefaultTreeAdapterTypes.ParentNode

export type ImportedScript = {
    type: 'script' | 'style'
    href: string
    elem: Element
    in: string
    out: string
}

// unenforced but necessary sequence:
//  injectPartials
//  collectScripts
//  rewriteHrefs
//  writeTo
export class HtmlEntrypoint {
    static async readFrom(
        urlPath: string,
        fsPath: string,
    ): Promise<HtmlEntrypoint> {
        const html = await readFile(fsPath, 'utf-8')
        return new HtmlEntrypoint(urlPath, html, fsPath)
    }

    #document: Document
    #fsPath: string
    #partials: Array<CommentNode> = []
    #scripts: Array<ImportedScript> = []
    #url: string

    constructor(url: string, html: string, fsPath: string) {
        this.#url = url
        this.#document = parse(html)
        this.#fsPath = fsPath
    }

    async injectPartials() {
        this.#collectPartials(this.#document)
        await this.#injectPartials()
    }

    collectScripts(): Array<ImportedScript> {
        this.#collectScripts(this.#document)
        return this.#scripts
    }

    // rewrites hrefs to content hashed urls
    // call without hrefs to rewrite tsx? ext to js
    rewriteHrefs(hrefs?: Record<string, string>) {
        for (const importScript of this.#scripts) {
            const rewriteTo = hrefs ? hrefs[importScript.in] : null
            if (importScript.type === 'script') {
                if (
                    importScript.in.endsWith('.tsx') ||
                    importScript.in.endsWith('.ts')
                ) {
                    importScript.elem.attrs.find(
                        attr => attr.name === 'src',
                    )!.value = rewriteTo || `/${importScript.out}.js`
                }
            } else if (importScript.type === 'style') {
                importScript.elem.attrs.find(
                    attr => attr.name === 'href',
                )!.value = rewriteTo || `/${importScript.out}.css`
            }
        }
    }

    async writeTo(buildDir: string): Promise<void> {
        await writeFile(
            join(buildDir, this.#url, 'index.html'),
            serialize(this.#document),
        )
    }

    async #injectPartials() {
        for (const commentNode of this.#partials) {
            const pp = commentNode.data
                .match(/\{\{(?<pp>.+)\}\}/)!
                .groups!.pp.trim()
            const fragment = parseFragment(await readFile(pp, 'utf-8'))
            for (const node of fragment.childNodes) {
                if (node.nodeName === 'script') {
                    this.#rewritePathFromPartial(pp, node, 'src')
                } else if (
                    node.nodeName === 'link' &&
                    hasAttr(node, 'rel', 'stylesheet')
                ) {
                    this.#rewritePathFromPartial(pp, node, 'href')
                }
                defaultTreeAdapter.insertBefore(
                    commentNode.parentNode!,
                    node,
                    commentNode,
                )
            }
            defaultTreeAdapter.detachNode(commentNode)
        }
    }

    // rewrite a ts or css href relative to an html partial to be relative to the html entrypoint
    #rewritePathFromPartial(
        pp: string,
        elem: Element,
        attrName: 'href' | 'src',
    ) {
        const attr = getAttr(elem, attrName)
        if (attr) {
            attr.value = join(
                relative(dirname(this.#fsPath), dirname(pp)),
                attr.value,
            )
        }
    }

    #collectPartials(node: ParentNode) {
        for (const childNode of node.childNodes) {
            if (childNode.nodeName === '#comment' && 'data' in childNode) {
                if (/\{\{.+\}\}/.test(childNode.data)) {
                    this.#partials.push(childNode)
                }
            } else if ('childNodes' in childNode) {
                this.#collectPartials(childNode)
            }
        }
    }

    #collectScripts(node: ParentNode) {
        for (const childNode of node.childNodes) {
            if (childNode.nodeName === 'script') {
                const srcAttr = childNode.attrs.find(
                    attr => attr.name === 'src',
                )
                if (srcAttr) {
                    this.#addScript('script', srcAttr.value, childNode)
                }
            } else if (
                childNode.nodeName === 'link' &&
                hasAttr(childNode, 'rel', 'stylesheet')
            ) {
                const hrefAttr = getAttr(childNode, 'href')
                if (hrefAttr) {
                    this.#addScript('style', hrefAttr.value, childNode)
                }
            } else if ('childNodes' in childNode) {
                this.#collectScripts(childNode)
            }
        }
    }

    #addScript(type: ImportedScript['type'], href: string, elem: Element) {
        const inPath = join(dirname(this.#fsPath), href)
        const outPath =
            'lib/sidelines/' + inPath.substring(0, inPath.lastIndexOf('.'))

        this.#scripts.push({
            type,
            href,
            elem,
            in: inPath,
            out: outPath,
        })
    }
}

function getAttr(elem: Element, name: string) {
    return elem.attrs.find(attr => attr.name === name)
}

function hasAttr(elem: Element, name: string, value: string): boolean {
    return elem.attrs.some(attr => attr.name === name && attr.value === value)
}
