import { removeChildElements } from './ui_dom.ts'
import { DankDevPane } from './ui_pane.ts'

type OpfsOrigin = {
    directories: Array<OpfsDir>
    files: Array<OpfsFile>
}

type OpfsEntry<E extends HTMLElement, C> = {
    element: E
    ctx: C
}

type OpfsDir = OpfsEntry<DankDevOpfsDir, OpfsDirContext>

type OpfsDirContext = {
    handle: FileSystemDirectoryHandle
    name: string
    directories: Array<OpfsDir>
    files: Array<OpfsFile>
}

type OpfsFile = OpfsEntry<DankDevOpfsFile, OpfsFileContext>

type OpfsFileContext = {
    handle: FileSystemFileHandle
    name: string
}

function opfsElementsOf(ctx: OpfsOrigin | OpfsDirContext): Array<HTMLElement> {
    return [
        ...ctx.directories.map(d => d.element),
        ...ctx.files.map(f => f.element),
    ]
}

export class DankDevOpfs extends HTMLElement {
    #entries: HTMLElement
    #origin: OpfsOrigin | null = null

    constructor() {
        super()
        this.append(
            new DankDevPane((this.#entries = document.createElement('div'))),
        )
    }

    async connectedCallback() {
        removeChildElements(this.#entries)
        this.#origin = await resolveOrigin()
        if (this.isConnected) {
            this.#entries.append(...opfsElementsOf(this.#origin))
        }
    }

    disconnectedCallback() {}
}

class DankDevOpfsDir extends HTMLElement {
    constructor(ctx: OpfsDirContext, depth: number) {
        super()
        const contents = document.createElement('div')
        contents.classList.add('opfs-dir-entries')
        contents.append(...opfsElementsOf(ctx))
        this.append(new DankDevOpfsEntry(ctx.name, depth, 'opfs-dir'), contents)
    }
}

class DankDevOpfsFile extends HTMLElement {
    #containerCode: HTMLElement
    #containerPre: HTMLElement
    #content: string | null = null
    #contentModified: number = 0
    #ctx: OpfsFileContext
    #opening: Promise<void> | false = false

    constructor(ctx: OpfsFileContext, depth: number) {
        super()
        this.#ctx = ctx
        this.append(
            new DankDevOpfsEntry(ctx.name, depth, 'opfs-file'),
            (this.#containerPre = document.createElement('pre')),
        )
        this.#containerPre.append(
            (this.#containerCode = document.createElement('code')),
        )
        this.addEventListener('click', () => {
            if (this.#isOpen()) {
                this.#containerPre.classList.remove('show')
            } else if (this.#opening) {
                this.#opening = false
            } else {
                this.#opening = this.#open()
            }
        })
    }

    #isOpen(): boolean {
        return this.#containerPre.classList.contains('show')
    }

    async #open(): Promise<void> {
        const file = await this.#ctx.handle.getFile()
        if (file.lastModified !== this.#contentModified) {
            this.#content = await readFile(file)
            this.#contentModified = file.lastModified
        }
        this.#show()
        this.#opening = false
    }

    #show() {
        if (this.#content) {
            this.#containerPre.classList.add('show')
            this.#containerCode.textContent = this.#content
        }
    }
}

class DankDevOpfsEntry extends HTMLElement {
    constructor(
        name: string,
        depth: number,
        maskImageClass: 'opfs-dir' | 'opfs-file',
    ) {
        super()
        this.style.setProperty('--offset-depth', '' + depth)
        const iconElem = document.createElement('span')
        iconElem.classList.add('mask-icon', maskImageClass)
        const nameElem = document.createElement('span')
        nameElem.textContent = name
        this.append(iconElem, nameElem)
    }
}

export async function readFile(file: File): Promise<string | null> {
    try {
        return await file.text()
    } catch (e) {
        if (e instanceof DOMException && e.name === 'NotFoundError') {
            return null
        } else {
            throw e
        }
    }
}

async function resolveOrigin(): Promise<OpfsOrigin> {
    const [directories, files] = await resolveElements(
        await collectEntries(await navigator.storage.getDirectory()),
        1,
    )
    return { directories, files }
}

async function resolveDir(
    name: string,
    depth: number,
    dir: FileSystemDirectoryHandle,
): Promise<OpfsDir> {
    const [directories, files] = await resolveElements(
        await collectEntries(dir),
        depth + 1,
    )
    const ctx = {
        handle: dir,
        name,
        directories,
        files,
    }
    return {
        element: new DankDevOpfsDir(ctx, depth),
        ctx,
    }
}

type OpfsDirEntries = Array<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
>

async function collectEntries(
    dir: FileSystemDirectoryHandle,
): Promise<OpfsDirEntries> {
    const entries: OpfsDirEntries = []
    for await (const [name, handle] of dir.entries()) {
        entries.push([name, handle])
    }
    return entries
}

async function resolveElements(
    entries: OpfsDirEntries,
    depth: number,
): Promise<[Array<OpfsDir>, Array<OpfsFile>]> {
    const dirs: Array<OpfsDir> = []
    const files: Array<OpfsFile> = []
    await Promise.allSettled(
        entries.map(async ([name, handle]) => {
            if (handle.kind === 'directory') {
                dirs.push(await resolveDir(name, depth, handle))
            } else {
                const ctx = { handle, name }
                files.push({
                    ctx,
                    element: new DankDevOpfsFile(ctx, depth),
                })
            }
        }),
    )
    return [dirs, files]
}

customElements.define('dank-dev-ui-opfs', DankDevOpfs)
customElements.define('dank-dev-ui-opfs-entry', DankDevOpfsEntry)
customElements.define('dank-dev-ui-opfs-dir', DankDevOpfsDir)
customElements.define('dank-dev-ui-opfs-file', DankDevOpfsFile)
