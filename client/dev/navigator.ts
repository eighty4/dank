export function copy(s: string) {
    navigator.clipboard.writeText(s).then(() => console.log('copied'))
}

export function isChromium(): boolean {
    if (navigator.userAgentData && navigator.userAgentData.brands) {
        return navigator.userAgentData.brands.some(
            ({ brand }) => brand === 'Chromium',
        )
    }
    return false
}

export function isFirefox(): boolean {
    return navigator.userAgent.toLowerCase().includes('firefox')
}
