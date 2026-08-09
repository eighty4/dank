declare global {
    interface Navigator {
        userAgentData?: NavigatorUAData
    }

    interface NavigatorUAData {
        readonly brands: Array<{
            brand: string
        }>
        readonly mobile: boolean
    }
}

export {}
