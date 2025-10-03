import type { ComposeService } from './compose.js'

export type PrepareTimingOption = 'early' | 'normal'

export type PrepareCommandConfig = {
  cmd: string
  name?: string
  fail?: boolean
  dir?: string
  timing?: PrepareTimingOption
}

export type SiteConfig = Record<string, string>

export type ConfigEntry =
  | string
  | Array<string | PrepareCommandConfig>
  | Record<string, SiteConfig>
  | WordPressUpdatesConfig

export type WordPressUpdatesConfig = {
  doNotUpdate?: string[]
  pluginFolder?: string
  themeFolder?: string
  wpRoot?: string
}

export type WordPressConfig = {
  doNotUpdate: string[]
  pluginFolder: string
  themeFolder: string
  wpRoot: string
}

export type InternalConfig = Record<string, string> & {
  prepareCommands?: Array<string | PrepareCommandConfig>
  sites?: Record<string, SiteConfig>
  wpUpdates?: WordPressUpdatesConfig
}

export type CommandOverride = {
  command: string
  source: string
  sourceType: string
}

export type DBContainerInfo = {
  name: string | undefined
  type: 'mysql' | 'mariadb'
  service: ComposeService
  adminCommand: string | undefined
  cliCommand: string | undefined
  dumpCommand: string | undefined
  credentials: {
    db: string | undefined
    user: string | undefined
    pass: string | undefined
  }
}

export type TerraformOutputJson = {
  sensitive: boolean
  type: string
  // TODO: Not necessarily a string - could be an object
  value: string
}
