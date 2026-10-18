export interface Theme {
    name: string
    default?: boolean;
    id: string
    color: string
}

interface MenuLink {
    name: string
    icon?: string
    url: string
}

/** Home Fin accounts/profiles (see homefin/SPEC.md). */
export interface HomefinAccountsConfig {
    enabled: boolean
    /** Where the accounts service is mounted, same origin as the web app. */
    apiPath?: string
}

export interface WebConfig {
    includeCorsCredentials?: boolean
    multiserver?: boolean
    themes?: Theme[]
    menuLinks?: MenuLink[]
    servers?: string[]
    plugins?: string[]
    homefinAccounts?: HomefinAccountsConfig
}
