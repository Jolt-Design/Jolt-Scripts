import type { PathLike } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import ansis from 'ansis'
import { camelCase, constantCase } from 'change-case'
import type { BaseContext } from 'clipanion'
import type { Options } from 'execa'
import { execa } from 'execa'
import realWhich from 'which'
import { ContainerRuntimeError } from './errors.js'

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

/**
 * Detects if an error message indicates a container runtime daemon is not running
 * Supports Docker, Podman, and Rancher Desktop
 */
function isContainerRuntimeError(errorMessage: string): boolean {
  const containerRuntimeErrorPatterns = [
    // Docker patterns
    /cannot connect to the docker daemon/i,
    /docker: error during connect/i,
    /is the docker daemon running/i,
    /connection refused.*docker/i,
    /docker desktop is not running/i,
    /error during connect.*docker/i,
    /failed to connect to.*docker/i,
    /dial unix.*docker\.sock.*connection refused/i,
    /connect: no such file or directory.*docker\.sock/i,

    // Podman patterns
    /cannot connect to podman/i,
    /error: unable to connect to podman/i,
    /is the podman service running/i,
    /connection refused.*podman/i,
    /podman desktop is not running/i,
    /unable to connect to podman socket/i,
    /dial unix.*podman\.sock.*connection refused/i,
    /connect: no such file or directory.*podman\.sock/i,

    // Rancher Desktop patterns (uses Docker API but with Rancher-specific paths)
    /rancher desktop is not running/i,
    /connection refused.*rancher/i,
    /dial unix.*rancher.*docker\.sock.*connection refused/i,
    /connect: no such file or directory.*rancher.*docker\.sock/i,
    /dial unix.*\.rd\/.*connection refused/i,
    /connect: no such file or directory.*\.rd\//i,
  ]

  return containerRuntimeErrorPatterns.some((pattern) => pattern.test(errorMessage))
}

/**
 * Detects the container runtime type from the command and error message
 */
function detectContainerRuntime(command: string, errorMessage: string): 'docker' | 'podman' | 'rancher' | 'unknown' {
  if (command.includes('podman') || /podman/i.test(errorMessage)) {
    return 'podman'
  }

  // Check for Rancher Desktop indicators in the error message
  if (/rancher/i.test(errorMessage) || /\.rd\//i.test(errorMessage)) {
    return 'rancher'
  }

  if (command.includes('docker') || /docker/i.test(errorMessage)) {
    return 'docker'
  }

  return 'unknown'
}

/**
 * Creates a user-friendly error message for container runtime issues
 */
function createContainerRuntimeErrorMessage(command: string, originalError: string): string {
  const runtime = detectContainerRuntime(command, originalError)

  let runtimeName: string
  let suggestion: string

  switch (runtime) {
    case 'podman':
      runtimeName = 'Podman'
      suggestion = 'Please start Podman Desktop or ensure the Podman service is running before retrying.'
      break
    case 'rancher':
      runtimeName = 'Rancher Desktop'
      suggestion = 'Please start Rancher Desktop or ensure the container runtime is running before retrying.'
      break
    default:
      runtimeName = 'Docker'
      suggestion = 'Please start Docker Desktop or ensure the Docker daemon is running before retrying.'
      break
  }

  const header = ansis.red(`🐳 ${runtimeName} daemon is not running!`)
  const suggestionText = ansis.yellow(suggestion)
  const details = ansis.gray(`Original error: ${originalError}`)

  return `${header}\n${suggestionText}\n${details}`
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

  try {
    return await execa(command, argsToUse as string[], allOptions)
  } catch (error: unknown) {
    // Check if this is a container runtime command that failed due to daemon not running
    if (
      error instanceof Error &&
      'stderr' in error &&
      typeof error.stderr === 'string' &&
      (command.includes('docker') || command.includes('podman'))
    ) {
      const errorMessage = error.stderr || error.message || ''

      if (isContainerRuntimeError(errorMessage)) {
        const friendlyMessage = createContainerRuntimeErrorMessage(command, errorMessage)

        // Write the friendly error to stderr if available
        if (options.context?.stderr) {
          options.context.stderr.write(`${friendlyMessage}\n`)
        }

        // Throw a specific ContainerRuntimeError for programmatic handling
        throw new ContainerRuntimeError(friendlyMessage)
      }
    }

    // Re-throw the original error if it's not a container runtime daemon issue
    throw error
  }
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
