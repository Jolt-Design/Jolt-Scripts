type PrepareTimingOption = 'early' | 'normal'

type PrepareCommandConfig = {
  cmd: string
  name?: string
  fail?: boolean
  dir?: string
  timing?: PrepareTimingOption
}

type SiteConfig = Record<string, string>
type ConfigEntry = string | Array<string | PrepareCommandConfig> | Record<string, SiteConfig>

type InternalConfig = Record<string, string> & {
  prepareCommands?: Array<string | PrepareCommandConfig>
  sites?: Record<string, SiteConfig>
}

type CommandOverride = {
  command: string
  source: string
  sourceType: string
}

type DBContainerInfo = {
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

type TerraformOutputJson = {
  sensitive: boolean
  type: string
  // TODO: Not necessarily a string - could be an object
  value: string
}
