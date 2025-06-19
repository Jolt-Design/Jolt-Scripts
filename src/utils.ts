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
  } catch {
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
    allOptions.stdin ||= options.context.stdin
    allOptions.stdout ||= options.context.stdout
    allOptions.stderr ||= options.context.stderr
  }

  return await execa(command, args, allOptions)
}

export function delay(ms: number): Promise<undefined> {
  return new Promise((res) => setTimeout(res, ms, null))
}

export async function replaceAsync(
  str: string,
  replace: RegExp | string,
  // biome-ignore lint/suspicious/noExplicitAny: this is the actual String.replace signature
  asyncFn: (substring: string, ...args: any[]) => Promise<string>,
) {
  const promises: Promise<string>[] = []

  str.replace(replace, (full, ...args) => {
    promises.push(asyncFn(full, ...args))
    return full
  })

  const data = await Promise.all(promises)

  return str.replace(replace, () => data.shift() || '')
}
