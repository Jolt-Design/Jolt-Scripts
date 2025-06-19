import { readFile } from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import shelljs from 'shelljs'
import { constToCamel, execC, fileExists, replaceAsync } from './utils.js'

const { which } = shelljs

type InternalConfig = Record<string, string>

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

const dbImageRegex = /\b(?<type>mysql|mariadb)\b/i
const ARG_REGEX = /{(?<type>(?:arg|param|cmd|db|tf|tofu|terraform|conf|config|git)):(?<variable>[a-z0-9_-]+)}/gi

function parseEnvFile(env: InternalConfig): InternalConfig {
  const parsed: InternalConfig = {}

  for (const [k, v] of Object.entries(env)) {
    parsed[constToCamel(k)] = v
  }

  return parsed
}

export const DEFAULT_AWS_REGION = 'eu-west-1'

class Config {
  private composeConfig: ComposeConfig | false | undefined
  private config: InternalConfig
  private _configPath?: string
  private site: string | undefined
  private tfCache: Record<string, string> | undefined

  get configPath() {
    return this._configPath
  }

  *[Symbol.iterator](): IterableIterator<[string, string]> {
    for (const entry of Object.entries(this.config)) {
      yield entry
    }
  }

  constructor(config: InternalConfig = {}, configPath: string | undefined = undefined) {
    this.config = config

    if (configPath) {
      this._configPath = path.resolve(configPath)
    }
  }

  setSite(site: string) {
    this.site = site
  }

  async command(name: string): Promise<string> {
    return (await this.getCommandOverride(name)).command
  }

  async getCommandOverride(command: string): Promise<CommandOverride> {
    let envVar: string
    let def: string

    switch (command) {
      case 'docker':
        def = 'docker'
        envVar = 'DOCKER_COMMAND'
        break
      case 'compose':
      case 'docker compose':
      case 'docker-compose':
      case 'docker_compose':
        def = 'docker compose'
        envVar = 'COMPOSE_COMMAND'
        break
      case 'tofu':
      case 'terraform':
        def = which('tofu') ? 'tofu' : 'terraform'
        envVar = 'TERRAFORM_COMMAND'
        break
      case 'node':
        def = 'node'
        envVar = 'NODE_COMMAND'
        break
      case 'yarn':
        def = 'yarn'
        envVar = 'YARN_COMMAND'
        break
      case 'aws':
        def = 'aws'
        envVar = 'AWS_COMMAND'
        break
      case 'ssh':
        def = 'ssh'
        envVar = 'SSH_COMMAND'
        break
      case 'rsync':
        def = 'rsync'
        envVar = 'RSYNC_COMMAND'
        break
      case 'git':
        def = 'git'
        envVar = 'GIT_COMMAND'
        break
      case 'gzip':
        def = 'gzip'
        envVar = 'GZIP_COMMAND'
        break
      default:
        return { command, source: 'unknown', sourceType: 'unknown' }
    }

    const toTry = [`JOLT_${envVar}`, envVar]

    for (const varName of toTry) {
      if (process.env[varName]) {
        return {
          command: process.env[varName],
          source: varName,
          sourceType: 'env',
        }
      }
    }

    const configName = constToCamel(envVar)
    const configuredValue = await this.get(configName)

    if (configuredValue) {
      return {
        command: configuredValue,
        source: configName,
        sourceType: 'config',
      }
    }

    return {
      command: def,
      source: 'Default',
      sourceType: 'default',
    }
  }

  async get(key: string): Promise<string | undefined> {
    if (this.site) {
      const capitalisedKey = key.charAt(0).toUpperCase() + key.slice(1)
      const keyToTry = `${this.site}${capitalisedKey}`

      if (this.config[keyToTry] !== undefined) {
        return await this.parseArg(this.config[keyToTry])
      }
    }

    return this.config[key] === undefined ? undefined : await this.parseArg(this.config[key])
  }

  has(key: string): boolean {
    if (this.site) {
      const capitalisedKey = key.charAt(0).toUpperCase() + key.slice(1)
      const keyToTry = `${this.site}${capitalisedKey}`

      if (this.config[keyToTry] !== undefined) {
        return true
      }
    }

    return key in this.config
  }

  // biome-ignore lint/suspicious/noExplicitAny: the TF var could be anything
  async tfVar(key: string, throwOnFail = false, trySite = true): Promise<any> {
    if (trySite && this.site) {
      const siteResult = await this.tfVar(`${this.site}_${key}`, false, false)

      if (siteResult) {
        return siteResult
      }
    }

    if (this.tfCache === undefined) {
      try {
        const result = await execC(await this.command('tofu'), ['output', '-json'])
        const output = result.stdout?.toString()

        if (output !== undefined) {
          const cache = JSON.parse(output)

          if (typeof cache === 'object') {
            this.tfCache = this.parseTfJson(cache)
          }
        }
      } catch (e) {
        if (throwOnFail) {
          throw e
        }
      }
    }

    if (this.tfCache?.[key]) {
      return this.tfCache[key]
    }

    return undefined
  }

  awsRegion(): string {
    return process.env.AWS_REGION ?? DEFAULT_AWS_REGION
  }

  async getDockerImageName(isDev = false): Promise<string | undefined> {
    if (isDev) {
      if (this.has('devImageName')) {
        return await this.get('devImageName')
      }

      const tfDevImageName = await this.tfVar('dev_docker_image_name')

      if (tfDevImageName) {
        return tfDevImageName
      }

      if (this.has('imageName')) {
        return `${await this.get('imageName')}-dev`
      }

      const tfImageName = await this.tfVar('docker_image_name')

      if (tfImageName) {
        return `${tfImageName}-dev`
      }

      return undefined
    }

    if (this.has('imageName')) {
      return await this.get('imageName')
    }

    const tfImageName = await this.tfVar('docker_image_name')

    if (tfImageName) {
      return tfImageName
    }
  }

  async getRemoteRepo(isDev = false): Promise<string | undefined> {
    if (isDev) {
      if (this.has('devRemoteRepo')) {
        return await this.get('devRemoteRepo')
      }

      const tfDevEcrRepo = await this.tfVar('dev_ecr_url')

      if (tfDevEcrRepo) {
        return tfDevEcrRepo
      }

      return undefined
    }

    if (this.has('remoteRepo')) {
      return await this.get('remoteRepo')
    }

    const tfEcrRepo = await this.tfVar('ecr_url')

    if (tfEcrRepo) {
      return tfEcrRepo
    }
  }

  async getComposeConfig(throwOnFail = false): Promise<ComposeConfig | undefined> {
    if (this.composeConfig !== undefined) {
      return this.composeConfig || undefined
    }

    try {
      const result = await execC(await this.command('compose'), ["--profile='*'", 'config', '--format=json'])
      const output = result.stdout?.toString()

      if (output !== undefined) {
        const parsed = JSON.parse(output)
        this.composeConfig = parsed
        return parsed
      }
    } catch (e) {
      if (throwOnFail) {
        throw e
      }

      this.composeConfig = false
      return undefined
    }
  }

  async getComposeCommand(): Promise<[string, string[]]> {
    const command = await this.command('compose')
    const parts = command.split(' ')
    return [parts[0], parts.slice(1)]
  }

  async getCacheContainerInfo() {
    const composeConfig = await this.getComposeConfig()
    const services = composeConfig?.services
    let container = (await this.get('cacheContainer')) ?? (await this.get('redisContainer'))
    let type = ''

    if (!container && services) {
      for (const [serviceName, service] of Object.entries(services)) {
        const match = service.image?.match(/\b(?<type>redis|valkey)\b/i)

        if (match) {
          container = serviceName
          type = match.groups?.type ?? ''
          break
        }
      }
    }

    if (!container || !services) {
      return
    }

    if (!type) {
      const { image } = services[container]
      const match = image?.match(/\b(?<type>redis|valkey)\b/i)

      if (match) {
        type = match.groups?.type?.toLowerCase() ?? ''
      }

      if (!type) {
        return
      }
    }

    let cliCommand: string

    switch (type) {
      case 'redis':
        cliCommand = 'redis-cli'
        break
      case 'valkey':
        cliCommand = 'valkey-cli'
        break
      default:
        return
    }

    return { name: container, type, cliCommand, service: services[container] }
  }

  async getDBContainerInfo(): Promise<DBContainerInfo | undefined> {
    const result: Partial<DBContainerInfo> = {}
    const composeConfig = await this.getComposeConfig()
    const services = composeConfig?.services

    if (this.has('dbContainer')) {
      result.name = (await this.get('dbContainer')) as string
    } else if (services) {
      for (const [serviceName, service] of Object.entries(services)) {
        const match = service.image?.match(dbImageRegex)

        if (match?.groups) {
          result.name = serviceName
          result.type = match.groups.type.toLowerCase() as DBContainerInfo['type']
          result.dumpCommand = this.getDBDumpCommandFromImageType(match.groups?.type as string)
          result.cliCommand = this.getDBCLICommandFromImageType(match.groups?.type as string)
          result.credentials = {
            db: service.environment?.DB_NAME,
            user: service.environment?.DB_USER,
            pass: service.environment?.DB_PASS,
          }
        }
      }
    }

    if (!result.name) {
      return
    }

    if (this.has('dbDumpCommand')) {
      result.dumpCommand = await this.get('dbDumpCommand')
    } else if (services) {
      const image = services[result.name]?.image

      if (image) {
        const match = image.match(dbImageRegex)
        result.type = match?.groups?.type.toLowerCase() as DBContainerInfo['type']
        result.dumpCommand = this.getDBDumpCommandFromImageType(match?.groups?.type as string)
        result.cliCommand = this.getDBCLICommandFromImageType(match?.groups?.type as string)
      }
    }

    if (!result.dumpCommand) {
      return
    }

    if (!result.credentials) {
      result.credentials = {
        db: undefined,
        user: undefined,
        pass: undefined,
      }
    }

    if (this.has('dbName')) {
      result.credentials.db = await this.get('dbName')
    }

    if (this.has('dbUser')) {
      result.credentials.user = await this.get('dbUser')
    }

    if (this.has('dbPass')) {
      result.credentials.pass = await this.get('dbPass')
    }

    if (Object.values(result.credentials).findIndex((x) => x === undefined) !== -1) {
      return
    }

    if (services) {
      result.service = services[result.name]
    }

    return result as DBContainerInfo
  }

  asJson() {
    return JSON.stringify(this.config)
  }

  async parseArg(arg: string, params: Record<string, string> = {}): Promise<string> {
    return await replaceAsync(arg, ARG_REGEX, async (x, ...args) => await this.parseArgCallback(x, params, ...args))
  }

  private async parseArgCallback(
    substring: string,
    params: Record<string, string> = {},
    // biome-ignore lint/suspicious/noExplicitAny: this is the actual String.replace signature
    ...args: any[]
  ): Promise<string> {
    const type: string = args[0]
    const name: string = args[1]

    switch (type?.toLowerCase()) {
      case 'arg':
      case 'param':
        return params[name] ?? substring
      case 'cmd':
        return this.command(name)
      case 'db':
        return (await this.getDBConfigEntry(name)) ?? substring
      case 'tf':
      case 'tofu':
      case 'terraform':
        return (await this.tfVar(name)) ?? substring
      case 'conf':
      case 'config':
        return (await this.get(name)) ?? substring
      case 'git':
        return (await this.gitVar(name)) ?? substring
    }

    return substring
  }

  async getDBConfigEntry(key: string): Promise<string | undefined> {
    const dbConfig = await this.getDBContainerInfo()

    switch (key) {
      case 'dumpCmd':
        return dbConfig?.dumpCommand
      case 'cliCmd':
        return dbConfig?.cliCommand
      case 'type':
        return dbConfig?.type
      case 'name':
        return dbConfig?.credentials.db
      case 'db':
      case 'user':
      case 'pass':
        return dbConfig?.credentials[key]
      case 'host':
        return dbConfig?.name
      default:
        return
    }
  }

  private getDBCLICommandFromImageType(type: string): string | undefined {
    switch (type) {
      case 'mysql':
        return 'mysql'
      case 'mariadb':
        return 'mariadb'
    }
  }

  private getDBDumpCommandFromImageType(type: string): string | undefined {
    switch (type) {
      case 'mysql':
        return 'mysqldump'
      case 'mariadb':
        return 'mariadb-dump'
    }
  }

  private parseTfJson(json: Record<string, TerraformOutputJson>) {
    const result: Record<string, string> = {}

    for (const [key, value] of Object.entries(json)) {
      result[key] = value.value
    }

    return result
  }

  private async gitVar(name: string): Promise<string | undefined> {
    const gitCommand = await this.command('git')

    if (!gitCommand) {
      return
    }

    switch (name) {
      case 'sha':
      case 'shortSha':
        return (await this.gitVar('longSha'))?.slice(0, 8)
      case 'longSha':
      case 'fullSha': {
        const commitShaResult = await execC(gitCommand, ['rev-parse', 'HEAD'], { shell: false, reject: false })

        if (commitShaResult.failed) {
          return
        }

        const sha = commitShaResult.stdout?.toString()

        if (sha) {
          return sha
        }
      }
    }
  }
}

let cachedConfig: Config

export default async function getConfig() {
  if (!cachedConfig) {
    const paths = ['.jolt.json', './bin/.env', '.env']

    for (const path of paths) {
      if (await fileExists(path)) {
        const contents = await readFile(path)

        if (contents.length === 0) {
          continue
        }

        let parsedConfig: InternalConfig

        if (path.endsWith('.env')) {
          parsedConfig = parseEnvFile(dotenv.parse(contents))
        } else if (path.endsWith('.json')) {
          parsedConfig = JSON.parse(contents.toString())
        } else {
          console.error(`Unknown config file type for path ${path}`)
          process.exit(10)
        }

        cachedConfig = new Config(parsedConfig, path)
        break
      }
    }

    cachedConfig ||= new Config()
  }

  return cachedConfig
}

export type { Config }
