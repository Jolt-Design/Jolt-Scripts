import type { PathLike } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { camelCase, constantCase } from 'change-case'
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
  return camelCase(key)
}

export function keyToConst(str: string): string {
  return constantCase(str)
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

export function delay(ms: number): Promise<null> {
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

// Cache for memoizing which() results since command availability doesn't change during execution
const whichCache = new Map<string, string | null>()

/**
 * Clear the which() cache - primarily for testing purposes
 */
export function clearWhichCache(): void {
  whichCache.clear()
}

export async function which(cmd: string): Promise<string | null> {
  // Check cache first
  if (whichCache.has(cmd)) {
    return whichCache.get(cmd) ?? null
  }

  let result: string | null = null

  const parts = cmd.split(' ')

  if (parts[1] === 'compose') {
    // First check if docker exists
    const dockerPath = await which(parts[0])

    if (!dockerPath) {
      result = null
    } else {
      // Then verify docker compose plugin is available
      try {
        await execa(parts[0], ['compose', 'version'], {
          stdio: 'ignore',
          timeout: 5000,
        })

        result = dockerPath
      } catch {
        // docker compose plugin not available
        result = null
      }
    }
  } else {
    result = await realWhich(cmd, { nothrow: true })
  }

  // Cache the result
  whichCache.set(cmd, result)

  return result
}

export async function getPackageJson(): Promise<PackageJson> {
  const contents = await readFile(`${import.meta.dirname}/../package.json`)
  return JSON.parse(contents.toString())
}
