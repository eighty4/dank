import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { cwd } from 'node:process'

export type DankDirectories = {
    buildRoot: string
    // output dir of html during `dank serve`
    buildWatch: string
    buildDist: string
    pages: string
    pagesResolved: string
    projectResolved: string
    projectRootAbs: string
    public: string
}

export async function defaultProjectDirs(
    projectRootAbs: string,
): Promise<Readonly<DankDirectories>> {
    if (!projectRootAbs) {
        projectRootAbs = cwd()
    } else if (!isAbsolute(projectRootAbs)) {
        throw Error()
    }
    const projectResolved = await realpath(projectRootAbs)
    const pages = 'pages'
    const pagesResolved = join(projectResolved, pages)
    return Object.freeze({
        buildRoot: 'build',
        buildDist: join('build', 'dist'),
        buildWatch: join('build', 'watch'),
        pages,
        pagesResolved,
        projectResolved,
        projectRootAbs,
        public: 'public',
    })
}

export type ResolveError = 'outofbounds'

export class Resolver {
    #dirs: DankDirectories

    constructor(dirs: DankDirectories) {
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
        return resolve(join(this.#dirs.projectResolved, p)).startsWith(
            this.#dirs.pagesResolved,
        )
    }

    // `p` is expected to be a relative path resolvable from the pages dir
    isPagesSubpathInPagesDir(p: string): boolean {
        return this.isProjectSubpathInPagesDir(join(this.#dirs.pages, p))
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
