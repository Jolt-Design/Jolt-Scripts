import type { PathLike } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { BaseContext } from 'clipanion'
import type { Options } from 'execa'
import { execa } from 'execa'

type ExecCOptions = Options & {
  context?: BaseContext
}

export async function fileExists(path: PathLike): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (e) {
    return false
  }
}

export function constToCamel(key: string): string {
  let parts = key.split('_')
  parts = parts.map((x) => x.toLocaleLowerCase().replace(/^./, (y) => y.toLocaleUpperCase()))
  parts[0] = parts[0].toLocaleLowerCase()

  return parts.join('')
}

export async function execC(command: string, args: string[] = [], options: ExecCOptions = {}) {
  const allOptions = {
    shell: true,
    ...options,
  }

  if (options.context) {
    allOptions.stdout ||= options.context.stdout
    allOptions.stderr ||= options.context.stderr
  }

  return await execa(command, args, allOptions)
}
