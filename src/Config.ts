import chalk from 'chalk'
import { Command, Option } from 'clipanion'
import dotenv from 'dotenv'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { stderr } from 'node:process'
import shelljs from 'shelljs'
import * as t from 'typanion'
import { constToCamel, execC, fileExists } from './utils.js'
const { which } = shelljs

type InternalConfig = Record<string, string>

type CommandOverride = {
  command: string
  source: string
  sourceType: string
}

enum ConfigCommandFormat {
  Pretty = 'pretty',
  Json = 'json',
}

function parseEnvFile(env: InternalConfig): InternalConfig {
  const parsed: InternalConfig = {}

  for (const [k, v] of Object.entries(env)) {
    parsed[constToCamel(k)] = v
  }

  return parsed
}

export const DEFAULT_AWS_REGION = 'eu-west-1'

export class Config {
  private config: InternalConfig;

  *[Symbol.iterator](): IterableIterator<[string, string]> {
    for (const entry of Object.entries(this.config)) {
      yield entry
    }
  }

  constructor(config: InternalConfig = {}) {
    this.config = config
  }

  command(name: string): string {
    return this.getCommandOverride(name).command
  }

  getCommandOverride(command: string): CommandOverride {
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
    const configuredValue = this.get(configName)

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

  get(key: string): string | undefined {
    return this.config[key]
  }

  has(key: string): boolean {
    return key in this.config
  }

  // biome-ignore lint/suspicious/noExplicitAny: the TF var could be anything
  async tfVar(key: string, throwOnFail = false): Promise<any> {
    try {
      const result = await execC(this.command('tofu'), ['output', '-json', key])
      const output = result.stdout?.toString()

      if (output !== undefined) {
        return JSON.parse(output)
      }
    } catch (e) {
      if (throwOnFail) {
        throw e
      }
    }
  }

  awsRegion(): string {
    return process.env.AWS_REGION ?? DEFAULT_AWS_REGION
  }

  async getDockerImageName(isDev = false): Promise<string | undefined> {
    if (isDev) {
      if (this.has('devImageName')) {
        return this.get('devImageName')
      }

      const tfDevImageName = await this.tfVar('dev_docker_image_name')

      if (tfDevImageName) {
        return tfDevImageName
      }

      if (this.has('imageName')) {
        return `${this.get('imageName')}-dev`
      }

      const tfImageName = await this.tfVar('docker_image_name')

      if (tfImageName) {
        return `${tfImageName}-dev`
      }

      return undefined
    }

    if (this.has('imageName')) {
      return this.get('imageName')
    }

    const tfImageName = await this.tfVar('docker_image_name')

    if (tfImageName) {
      return tfImageName
    }
  }

  async getRemoteRepo(isDev = false): Promise<string | undefined> {
    if (isDev) {
      if (this.has('devRemoteRepo')) {
        return this.get('devRemoteRepo')
      }

      const tfDevEcrRepo = await this.tfVar('dev_ecr_url')

      if (tfDevEcrRepo) {
        return tfDevEcrRepo
      }

      return undefined
    }

    if (this.has('remoteRepo')) {
      return this.get('remoteRepo')
    }

    const tfEcrRepo = await this.tfVar('ecr_url')

    if (tfEcrRepo) {
      return tfEcrRepo
    }
  }

  asJson() {
    return JSON.stringify(this.config)
  }
}

const logo = chalk.magentaBright('⚡')
let cachedConfig: Config
let configPath: string

export default async function getConfig() {
  if (!cachedConfig) {
    const paths = ['./bin/.env', '.env']

    for (const path of paths) {
      if (await fileExists(path)) {
        const contents = await readFile(path)
        const parsedConfig = parseEnvFile(dotenv.parse(contents))

        cachedConfig = new Config(parsedConfig)
        configPath = path
        break
      }
    }

    cachedConfig ||= new Config()
  }

  return cachedConfig
}

export class ConfigCommand extends Command {
  static paths = [['config']]

  format: ConfigCommandFormat | undefined = Option.String('--format', {
    required: false,
    validator: t.isEnum(ConfigCommandFormat),
  })

  commands = ['aws', 'docker', 'docker-compose', 'node', 'ssh', 'tofu', 'yarn']

  async execute(): Promise<number | undefined> {
    const {
      format,
      context: { stdout },
    } = this
    const config = await getConfig()

    if (format === undefined || format === ConfigCommandFormat.Pretty) {
      stdout.write(chalk.bold.whiteBright(`${logo} ${this.cli.binaryLabel} Config\n\n`))

      await this.listCommands()
      stdout.write('\n')
      await this.listConfig()
      return 0
    }

    if (format === ConfigCommandFormat.Json) {
      stderr.write(`${config.asJson()}\n`)
      return 0
    }

    stderr.write(chalk.red(`Unknown format "${format}"\n`))
    return 1
  }

  async listCommands() {
    const {
      commands,
      context: { stdout },
    } = this
    const config = await getConfig()

    stdout.write(chalk.bold.blue('Commands:\n'))

    for (const commandName of commands) {
      const { command, source, sourceType } = config.getCommandOverride(commandName)

      stdout.write(chalk.bold(`${commandName}: `))

      if (which(command)) {
        stdout.write(chalk.green(command))
      } else {
        stdout.write(chalk.red(`${command} ${chalk.bold('[Missing!]')}`))
      }

      let sourceString = ''

      switch (sourceType) {
        case 'env':
          sourceString = `[Env var: ${source}]`
          break
        case 'config':
          sourceString = `[Config: ${source}]`
          break
      }

      if (sourceString) {
        stdout.write(` ${chalk.gray(sourceString)}`)
      }

      stdout.write('\n')
    }
  }

  async listConfig() {
    const config = await getConfig()
    const {
      context: { stdout },
    } = this

    const sourceString = configPath ? chalk.dim(`[Source file: ${path.resolve(configPath)}]`) : ''
    stdout.write(chalk.bold.blue(`Config: ${sourceString}\n`))

    for (const [key, value] of config) {
      stdout.write(chalk.bold(`${key}: `))
      stdout.write(`${value}\n`)
    }
  }
}
