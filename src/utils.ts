import type { PathLike } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { BaseContext } from 'clipanion'
import type { Options } from 'execa'
import { execa } from 'execa'
import realWhich from 'which'

type ExecCOptions = Options & {
  context?: BaseContext
  cleanArgs?: boolean
}

export async function fileExists(path: PathLike): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

export async function directoryExists(path: PathLike): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
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

export function keyToConst(str: string): string {
  return (
    str
      .match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
      ?.map((x) => x.toLowerCase())
      .join('_')
      .toUpperCase() || str
  )
}

export async function execC(
  command: string,
  args: (string | null | undefined | false)[] = [],
  options: ExecCOptions = {},
) {
  const allOptions = {
    shell: true,
    cleanArgs: true,
    ...options,
  }

  if (options.context) {
    allOptions.stdin ||= options.context.stdin
    allOptions.stdout ||= options.context.stdout
    allOptions.stderr ||= options.context.stderr
  }

  let argsToUse = args

  if (allOptions.cleanArgs) {
    argsToUse = args.filter((x) => !!x)
  }

  return await execa(command, argsToUse as string[], allOptions)
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

export async function which(cmd: string): Promise<string | null> {
  const parts = cmd.split(' ')
  if (parts[1] === 'compose') {
    // TODO: Check for compose extension?
    return await which(parts[0])
  }

  return await realWhich(cmd, { nothrow: true })
}

export async function getPackageJson(): Promise<PackageJson> {
  const contents = await readFile('./package.json')
  return JSON.parse(contents.toString())
}
