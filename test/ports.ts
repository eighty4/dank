import { Socket } from 'node:net'

export async function getAvailablePort(doNotUse?: number) {
    let port: number
    do {
        port = getRandomPort()
    } while (port === doNotUse || (await isPortListening(port)))
    return port
}

function getRandomPort() {
    const min = Math.ceil(7000)
    const max = Math.floor(8000)
    return Math.floor(Math.random() * (max - min + 1)) + min
}

export async function waitForPort(port: number) {
    const TIMEOUT = 5000
    const DELAY = 100
    const INTERVAL = 20
    await new Promise(res => setTimeout(res, DELAY))
    const timeout = Date.now() + (TIMEOUT - DELAY)
    do {
        await new Promise(res => setTimeout(res, INTERVAL))
        if (await isPortListening(port)) {
            return
        }
    } while (Date.now() < timeout)
    throw Error(`waitForPort ${port} timed out after ${TIMEOUT}ms`)
}

export async function isPortListening(port: number): Promise<boolean> {
    return new Promise(res => {
        const s = new Socket()
        s.once('connect', () => {
            s.end()
            s.unref()
            res(true)
        })
        s.once('error', () => {
            s.end()
            s.unref()
            res(false)
        })
        s.connect(port, '127.0.0.1')
    })
}
