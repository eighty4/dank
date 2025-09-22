type EsbuildEvent = {
    added: Array<any>
    updated: Array<any>
    removed: Array<string>
}

new EventSource('http://127.0.0.1:2999/esbuild').addEventListener(
    'change',
    (e: MessageEvent) => {
        const change: EsbuildEvent = JSON.parse(e.data)
        const cssUpdates = change.updated.filter(p => p.endsWith('.css'))
        if (cssUpdates.length) {
            console.log('esbuild css updates', cssUpdates)
            const cssLinks: Record<string, HTMLLinkElement> = {}
            for (const elem of document.getElementsByTagName('link')) {
                if (elem.getAttribute('rel') === 'stylesheet') {
                    const url = new URL(elem.href)
                    if ((url.host = location.host)) {
                        cssLinks[url.pathname] = elem
                    }
                }
            }
            let swappedCss: boolean = false
            for (const cssUpdate of cssUpdates) {
                const cssLink = cssLinks[cssUpdate]
                if (cssLink) {
                    const next = cssLink.cloneNode() as HTMLLinkElement
                    next.href = `${cssUpdate}?${Math.random().toString(36).slice(2)}`
                    next.onload = () => cssLink.remove()
                    cssLink.parentNode!.insertBefore(next, cssLink.nextSibling)
                    swappedCss = true
                }
            }
            if (swappedCss) {
                addCssUpdateIndicator()
            }
        }
        if (cssUpdates.length < change.updated.length) {
            const jsUpdates = change.updated.filter(p => !p.endsWith('.css'))
            const jsScripts: Set<string> = new Set()
            for (const elem of document.getElementsByTagName('script')) {
                if (elem.src.length) {
                    const url = new URL(elem.src)
                    if ((url.host = location.host)) {
                        jsScripts.add(url.pathname)
                    }
                }
            }
            if (jsUpdates.some(jsUpdate => jsScripts.has(jsUpdate))) {
                console.log('esbuild js updates require reload')
                addJsReloadIndicator()
            }
        }
    },
)

function addCssUpdateIndicator() {
    const indicator = createUpdateIndicator('green', '9999')
    indicator.style.transition = 'opacity ease-in-out .38s'
    indicator.style.opacity = '0'
    indicator.ontransitionend = () => {
        if (indicator.style.opacity === '1') {
            indicator.style.opacity = '0'
        } else {
            indicator.remove()
            indicator.onload = null
            indicator.ontransitionend = null
        }
    }
    document.body.appendChild(indicator)
    setTimeout(() => (indicator.style.opacity = '1'), 0)
}

function addJsReloadIndicator() {
    document.body.appendChild(createUpdateIndicator('orange', '9000'))
}

function createUpdateIndicator(
    color: 'green' | 'orange',
    zIndex: '9000' | '9999',
): HTMLDivElement {
    const indicator = document.createElement('div')
    indicator.style.border = '6px dashed ' + color
    indicator.style.zIndex = zIndex
    indicator.style.position = 'fixed'
    indicator.style.top = indicator.style.left = '1px'
    indicator.style.height = indicator.style.width = 'calc(100% - 2px)'
    indicator.style.boxSizing = 'border-box'
    return indicator
}
