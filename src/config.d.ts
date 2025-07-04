type ConfigEntry = string | string[]

type InternalConfig = Record<string, string> & {
  prepareCommands?: string[]
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
