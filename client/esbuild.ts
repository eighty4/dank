import css from './esbuild.css'

const initializingCSS = new CSSStyleSheet().replace(css)

export type EsbuildEvent = {
    added: Array<string>
    updated: Array<any>
    removed: Array<string>
}

enum EsbuildUpdate {
    CSS = 'css',
    JS = 'js',
}

class EsbuildEventSubscription extends HTMLElement {
    #jsIndicator: EsbuildUpdateIndicator | null = null
    #shadow: ShadowRoot
    #stream: EventSource = new EventSource('http://127.0.0.1:3995/esbuild')

    constructor() {
        super()
        this.#shadow = this.attachShadow({ mode: 'open' })
        initializingCSS.then(styleSheet => {
            this.#shadow.adoptedStyleSheets = [styleSheet]
            this.#stream.addEventListener(
                'change',
                (e: MessageEvent<string>) => {
                    this.#onEsbuildEvent(JSON.parse(e.data))
                },
            )
        })
    }

    #onEsbuildEvent(e: EsbuildEvent) {
        const updates = updatesFromEsbuildEvent(e)
        for (const update of updates) {
            switch (update) {
                case EsbuildUpdate.CSS:
                    this.#shadow.append(new EsbuildUpdateIndicator(update))
                    break
                case EsbuildUpdate.JS:
                    if (!this.#jsIndicator) {
                        this.#shadow.append(
                            (this.#jsIndicator = new EsbuildUpdateIndicator(
                                update,
                            )),
                        )
                    }
                    break
            }
        }
    }
}

class EsbuildUpdateIndicator extends HTMLElement {
    constructor(update: EsbuildUpdate) {
        super()
        this.classList.add(update)
        switch (update) {
            case 'css':
                this.#animateForCSS()
                break
            case 'js':
                this.#animateForJS()
                break
            default:
                console.error('wtf')
        }
    }

    #animateForCSS() {
        const animation = this.animate(
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
        animation.finished.then(() => this.remove())
    }

    #animateForJS() {
        this.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 400,
            iterations: 1,
            direction: 'normal',
            easing: 'ease-in',
            fill: 'forwards',
        })
    }
}

customElements.define('dank-esbuild-indicator', EsbuildUpdateIndicator)
customElements.define('dank-esbuild-events', EsbuildEventSubscription)

document.body.prepend(new EsbuildEventSubscription())

function updatesFromEsbuildEvent(e: EsbuildEvent): Set<EsbuildUpdate> {
    const updates: Set<EsbuildUpdate> = new Set()
    const changes: Set<string> = new Set()
    for (const c of e.updated) changes.add(c)
    const cssUpdates = Array.from(changes).filter(p => p.endsWith('.css'))
    if (cssUpdates.length) {
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
            updates.add(EsbuildUpdate.CSS)
        }
    }
    if (cssUpdates.length < changes.size) {
        const jsUpdates = Array.from(changes).filter(p => !p.endsWith('.css'))
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
            updates.add(EsbuildUpdate.JS)
        }
    }
    return updates
}
