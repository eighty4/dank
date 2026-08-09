export function getScriptLocation(): string {
    if (isWorkerScope() || !document.currentScript) {
        return joinPathAndParamsOfURL(new URL(location.href))
    }
    if (document.currentScript instanceof HTMLScriptElement) {
        return joinPathAndParamsOfURL(new URL(document.currentScript.src))
    }
    throw TypeError()
}

function isWorkerScope() {
    return typeof window === 'undefined' && typeof importScripts !== 'undefined'
}

function joinPathAndParamsOfURL(url: URL): string {
    if (url.searchParams.size) {
        return url.pathname + '?' + url.searchParams.toString()
    } else {
        return url.pathname
    }
}
