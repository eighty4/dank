export type EsbuildEvent = {
    added: Array<string>
    updated: Array<any>
    removed: Array<string>
}

new EventSource('http://127.0.0.1:3995/esbuild').addEventListener(
    'change',
    (e: MessageEvent) => {
        const { updated }: EsbuildEvent = JSON.parse(e.data)
        const changes: Set<string> = new Set()
        for (const c of updated) changes.add(c)
        const cssUpdates = Array.from(changes).filter(p => p.endsWith('.css'))
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
        if (cssUpdates.length < changes.size) {
            const jsUpdates = Array.from(changes).filter(
                p => !p.endsWith('.css'),
            )
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

export function addCssUpdateIndicator() {
    const indicator = createUpdateIndicator('green', '23995')
    indicator.style.opacity = '0'
    indicator.animate(
        [
            { opacity: 0 },
            { opacity: 1 },
            { opacity: 1 },
            { opacity: 1 },
            { opacity: 0.75 },
            { opacity: 0.5 },
            { opacity: 0.25 },
            { opacity: 0 },
        ],
        {
            duration: 400,
            iterations: 1,
            direction: 'normal',
            easing: 'linear',
        },
    )
    document.body.appendChild(indicator)
    Promise.all(indicator.getAnimations().map(a => a.finished)).then(() =>
        indicator.remove(),
    )
}

let jsIndicator: HTMLElement | null = null

function addJsReloadIndicator() {
    if (jsIndicator) return
    jsIndicator = createUpdateIndicator('orange', '33995')
    jsIndicator.style.opacity = '0'
    jsIndicator.style.pointerEvents = 'none'
    jsIndicator.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 400,
        iterations: 1,
        direction: 'normal',
        easing: 'ease-in',
        fill: 'forwards',
    })
    document.body.appendChild(jsIndicator)
}

function createUpdateIndicator(
    color: 'green' | 'orange',
    zIndex: '23995' | '33995',
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
