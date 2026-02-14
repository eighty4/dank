import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export type DankDirectories = {
    buildRoot: string
    // output dir of html during `dank serve`
    buildWatch: string
    buildDist: string
    pages: string
    pagesAbs: string
    projectRootAbs: string
    public: string
}

export async function defaultProjectDirs(
    projectRootAbs: string,
): Promise<Readonly<DankDirectories>> {
    if (!isAbsolute(projectRootAbs)) {
        throw Error('must use an absolute project root path')
    }
    if ((await realpath(projectRootAbs)) !== projectRootAbs) {
        throw Error('must use a real project root path')
    }
    const pages = 'pages'
    return Object.freeze({
        buildRoot: 'build',
        buildDist: join('build', 'dist'),
        buildWatch: join('build', 'watch'),
        pages,
        pagesAbs: join(projectRootAbs, pages),
        projectRootAbs,
        public: 'public',
    })
}

export type ResolveError = 'outofbounds'

export class Resolver {
    static create(dirs: DankDirectories): Resolver {
        if (process.platform === 'win32') {
            return new WindowsResolver(dirs)
        } else {
            return new Resolver(dirs)
        }
    }

    #dirs: DankDirectories

    protected constructor(dirs: DankDirectories) {
        this.#dirs = dirs
    }

    // cross platform safe absolute path resolution from pages dir
    absPagesPath(...p: Array<string>): string {
        return join(this.#dirs.projectRootAbs, this.#dirs.pages, ...p)
    }

    // cross platform safe absolute path resolution from project root
    absProjectPath(...p: Array<string>): string {
        return join(this.#dirs.projectRootAbs, ...p)
    }

    // `p` is expected to be a relative path resolvable from the project dir
    isProjectSubpathInPagesDir(p: string): boolean {
        return resolve(join(this.#dirs.projectRootAbs, p)).startsWith(
            this.#dirs.pagesAbs,
        )
    }

    // `p` is expected to be a relative path resolvable from the pages dir
    isPagesSubpathInPagesDir(p: string): boolean {
        return this.isProjectSubpathInPagesDir(join(this.#dirs.pages, p))
    }

    projectPathFromAbsolute(p: string) {
        return p.replace(this.#dirs.projectRootAbs, '').substring(1)
    }

    // resolve a pages subpath from a resource within the pages directory by a relative href
    // `from` is expected to be a pages resource fs path starting with `pages/` and ending with filename
    // the result will be a pages subpath and will not have the pages dir prefix
    // returns 'outofbounds' if the relative path does not resolve to a file within the pages dir
    resolveHrefInPagesDir(from: string, href: string): string | ResolveError {
        const p = join(dirname(from), href)
        if (this.isProjectSubpathInPagesDir(p)) {
            return p
        } else {
            return 'outofbounds'
        }
    }
}

class WindowsResolver extends Resolver {
    constructor(dirs: DankDirectories) {
        super(dirs)
    }

    projectPathFromAbsolute(p: string): string {
        return super.projectPathFromAbsolute(p).replaceAll('\\', '/')
    }

    resolveHrefInPagesDir(from: string, href: string): string | ResolveError {
        return super.resolveHrefInPagesDir(from, href).replaceAll('\\', '/')
    }
}
