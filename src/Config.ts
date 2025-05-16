import dotenv from 'dotenv'
import type { PathLike } from 'node:fs'
import { stat, readFile } from 'node:fs/promises'

type InternalConfig = Record<string, string>

async function fileExists(path: PathLike): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (e) {
    return false
  }
}

function parseEnvFile(env: InternalConfig): InternalConfig {
  const parsed: InternalConfig = {}

  for (const [k, v] of Object.entries(env)) {
    parsed[constToCamel(k)] = v
  }

  return parsed
}

function constToCamel(key: string): string {
  let parts = key.split('_')
  parts = parts.map((x) => x.toLocaleLowerCase().replace(/^./, (y) => y.toLocaleUpperCase()))
  parts[0] = parts[0].toLocaleLowerCase()

  return parts.join('')
}

class Config {
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
