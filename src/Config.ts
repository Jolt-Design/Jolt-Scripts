import { readFile } from 'node:fs/promises'
import dotenv from 'dotenv'
import { constToCamel, fileExists } from './utils.js'

type InternalConfig = Record<string, string>

function parseEnvFile(env: InternalConfig): InternalConfig {
  const parsed: InternalConfig = {}

  for (const [k, v] of Object.entries(env)) {
    parsed[constToCamel(k)] = v
  }

  return parsed
}

export class Config {
  private config: InternalConfig

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
