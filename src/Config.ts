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
