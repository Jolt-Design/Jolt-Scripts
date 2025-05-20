import { readFile } from 'node:fs/promises'
import dotenv from 'dotenv'
import { constToCamel, execC, fileExists } from './utils.js'
import shelljs from 'shelljs'
const { which } = shelljs

type InternalConfig = Record<string, string>

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
    let envVar: string
    let def: string

    switch (name) {
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
        return name
    }

    const toTry = [`JOLT_${envVar}`, envVar]

    for (const varName of toTry) {
      if (process.env[varName]) {
        return process.env[varName]
      }
    }

    const configuredValue = this.get(constToCamel(envVar))

    if (configuredValue) {
      return configuredValue
    }

    return def
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
}

export default async function getConfig() {
  const paths = ['./bin/.env', '.env']

  for (const path of paths) {
    if (await fileExists(path)) {
      const contents = await readFile(path)
      const config = parseEnvFile(dotenv.parse(contents))

      return new Config(config)
    }
  }

  return new Config()
}
