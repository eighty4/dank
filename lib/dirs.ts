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

    isPagesSubpathResolvedToPagesDirSubpath(p: string): boolean {
        return verifySubpathInRoot(this.#dirs.pagesAbs, this.#dirs.pagesAbs, p)
    }

    isPagesSubpathResolvedToProjectDirSubpath(p: string): boolean {
        return verifySubpathInRoot(
            this.#dirs.pagesAbs,
            this.#dirs.projectRootAbs,
            p,
        )
    }

    isProjectSubpathResolvedToPagesDirSubpath(p: string): boolean {
        return verifySubpathInRoot(
            this.#dirs.projectRootAbs,
            this.#dirs.pagesAbs,
            p,
        )
    }

    isProjectSubpathResolvedToProjectDirSubpath(p: string): boolean {
        return verifySubpathInRoot(
            this.#dirs.projectRootAbs,
            this.#dirs.projectRootAbs,
            p,
        )
    }

    projectPathFromAbsolute(p: string) {
        return p.replace(this.#dirs.projectRootAbs, '').substring(1)
    }

    // `from` is expected to be a pages resource fs path starting with `pages/` and ending with filename
    // `href` is a source relative path to another source used by a script src, link href or Worker ctor URL
    // returns 'outofbounds' if the resolved path is not in the pages directory
    resolvePagesRelativeHrefInPagesDir(
        from: string,
        href: string,
    ): string | ResolveError {
        const p = join(dirname(from), href)
        if (this.isProjectSubpathResolvedToPagesDirSubpath(p)) {
            return p
        } else {
            return 'outofbounds'
        }
    }

    // `from` is expected to be a pages resource fs path starting with `pages/` and ending with filename
    // `href` is a source relative path to another source used by a script src, link href or Worker ctor URL
    // returns 'outofbounds' if the resolved path is not in the project directory
    resolvePagesRelativeHrefInProjectDir(
        from: string,
        href: string,
    ): string | ResolveError {
        const p = join(dirname(from), href)
        if (this.isProjectSubpathResolvedToProjectDirSubpath(p)) {
            return p
        } else {
            return 'outofbounds'
        }
    }
}

function verifySubpathInRoot(
    resolveFrom: string,
    expectWithin: string,
    testSubpath: string,
): boolean {
    return resolve(join(resolveFrom, testSubpath)).startsWith(expectWithin)
}

class WindowsResolver extends Resolver {
    constructor(dirs: DankDirectories) {
        super(dirs)
    }

    projectPathFromAbsolute(p: string): string {
        return super.projectPathFromAbsolute(p).replaceAll('\\', '/')
    }

    resolvePagesRelativeHrefInPagesDir(
        from: string,
        href: string,
    ): string | ResolveError {
        return super
            .resolvePagesRelativeHrefInPagesDir(from, href)
            .replaceAll('\\', '/')
    }

    resolvePagesRelativeHrefInProjectDir(
        from: string,
        href: string,
    ): string | ResolveError {
        return super
            .resolvePagesRelativeHrefInProjectDir(from, href)
            .replaceAll('\\', '/')
    }
}
