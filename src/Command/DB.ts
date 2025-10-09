import { createReadStream, createWriteStream, statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import ansis from 'ansis'
import { Option } from 'clipanion'
import { execa } from 'execa'
import * as t from 'typanion'
import { delay, execC, which } from '../utils.js'
import JoltCommand from './JoltCommand.js'

/**
 * Format file size in human readable format
 */
function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`
}

/**
 * Get database size in bytes
 */
async function getDatabaseSize(
  composeCommand: string,
  composeArgs: string[],
  containerInfo: { name: string; cliCommand: string; credentials: { db: string; user: string; pass: string } },
): Promise<number | null> {
  try {
    const { name: container, cliCommand, credentials } = containerInfo

    // SQL query to get database size in bytes
    const sizeQuery = `SELECT SUM(data_length + index_length) AS size_bytes FROM information_schema.tables WHERE table_schema = '${credentials.db}';`

    const result = await execC(
      composeCommand,
      [
        ...composeArgs,
        'exec',
        container,
        cliCommand,
        '-h',
        '127.0.0.1',
        '-u',
        credentials.user,
        `-p${credentials.pass}`,
        credentials.db,
        '-e',
        sizeQuery,
        '--skip-column-names',
      ],
      {
        shell: false,
        reject: false,
      },
    )

    if (result.exitCode === 0 && result.stdout != null) {
      // Convert stdout to string regardless of its type
      const stdoutStr = String(result.stdout).trim()

      const sizeBytes = Number.parseInt(stdoutStr, 10)
      return Number.isNaN(sizeBytes) ? null : sizeBytes
    }

    return null
  } catch {
    return null
  }
}

/**
 * Monitor file size and show progress
 */
function startProgressMonitor(filePath: string, stderr: NodeJS.WritableStream, expectedSize?: number): () => void {
  const startTime = Date.now()

  const interval = setInterval(() => {
    try {
      const stats = statSync(filePath)
      const currentSize = stats.size
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const bytesPerSecond = elapsed > 0 ? currentSize / elapsed : 0
      const rate = formatFileSize(bytesPerSecond)

      let progressText = `🛢️ Dumping... ${formatFileSize(currentSize)} written (${rate}/s, ${elapsed}s elapsed)`

      if (expectedSize && expectedSize > 0) {
        const percentage = Math.min(100, Math.floor((currentSize / expectedSize) * 100))
        progressText = `🛢️ Dumping... ${formatFileSize(currentSize)}/${formatFileSize(expectedSize)} (${percentage}%, ${rate}/s, ${elapsed}s elapsed)`
      }

      // Clear previous line and show progress
      stderr.write('\r\x1b[K') // Clear line
      stderr.write(ansis.blue(progressText))
    } catch {
      // File might not exist yet, ignore errors
    }
  }, 1000) // Update every second

  return () => {
    clearInterval(interval)
    stderr.write('\r\x1b[K') // Clear progress line
  }
}

export class DBDumpCommand extends JoltCommand {
  static paths = [['db', 'dump']]
  requiredCommands = ['docker', 'compose']
  backup = Option.Boolean('--backup', false, { description: 'Create a timestamped backup file' })
  quiet = Option.Boolean('--quiet, -q', false, { description: 'Suppress progress output' })

  getRequiredConfig(): string[] {
    return this.backup ? ['dbBackupPath'] : ['dbSeed']
  }

  async command(): Promise<number | undefined> {
    const {
      backup,
      quiet,
      config,
      context: { stdout, stderr },
    } = this

    let filename: string
    let shouldGzip = backup

    if (backup) {
      const now = new Date()
      const date = now
        .toISOString()
        .replace('T', '_')
        .replace(/:/g, '-')
        .replace(/\.\d+Z.*$/, '')

      filename = `backup-${date}.sql`
    } else {
      const configSeed = await config.get('dbSeed')
      filename = configSeed as string
    }

    const [composeCommand, args] = await config.getComposeCommand()
    const containerInfo = await config.getDBContainerInfo()

    if (!containerInfo) {
      stderr.write(ansis.red(`🛢️ Couldn't find information about database container. Try setting config explicitly.\n`))
      return 2
    }

    const { name: container, dumpCommand, credentials, cliCommand } = containerInfo
    const backupPath = backup ? await config.get('dbBackupPath') : undefined
    let filePath = backup ? path.resolve(backupPath as string, filename) : path.resolve(filename)

    if (filePath.endsWith('.gz')) {
      shouldGzip = true
      filePath = filePath.replace(/\.gz$/, '')
    }

    if (!quiet) {
      stdout.write(ansis.blue(`🛢️ Dumping contents of the DB in container '${container}' to ${filePath}...\n`))
    }

    // Try to get database size for progress estimation
    let dbSize: number | null = null

    if (cliCommand && credentials.db && credentials.user && credentials.pass) {
      if (!quiet) {
        stdout.write(ansis.blue('🛢️ Getting database size for progress estimation...\n'))
      }

      dbSize = await getDatabaseSize(composeCommand, args, {
        name: container || '',
        cliCommand,
        credentials: {
          db: credentials.db,
          user: credentials.user,
          pass: credentials.pass,
        },
      })

      if (dbSize && !quiet) {
        stdout.write(ansis.blue(`🛢️ Database size: ${formatFileSize(dbSize)}\n`))
      }
    }

    args.push(
      'exec',
      container || '',
      dumpCommand || '',
      '--skip-add-drop-table',
      '-u',
      credentials.user || '',
      `-p${credentials.pass}`,
      credentials.db || '',
    )

    // Start progress monitoring (only if not quiet)
    const stopProgress = quiet ? () => {} : startProgressMonitor(filePath, stderr, dbSize || undefined)

    let result: Awaited<ReturnType<typeof execa>>
    try {
      result = await execa(composeCommand, args, {
        buffer: { stdout: false },
        stderr,
        stdout: { file: filePath },
      })
    } finally {
      // Always stop progress monitoring
      stopProgress()
    }

    if (shouldGzip) {
      if (await which('gzip')) {
        stderr.write(ansis.blue('🛢️ Gzipping file...\n'))
        await execa('gzip', ['--force', filePath], { stdout, stderr })
        filePath = `${filePath}.gz`
      } else {
        stderr.write(ansis.blue('🛢️ Gzipping file using Node zlib...\n'))
        stderr.write(
          ansis.yellow('⚠️  Note: Using Node.js compression may be slower than external gzip for large files.\n'),
        )
        stderr.write(ansis.yellow('⚠️  Install the gzip command for improved performance.\n'))

        try {
          const gzipPath = `${filePath}.gz`
          const readStream = createReadStream(filePath)
          const writeStream = createWriteStream(gzipPath)
          const gzipStream = createGzip()

          await pipeline(readStream, gzipStream, writeStream)

          // Remove the original uncompressed file after successful compression
          await unlink(filePath)

          filePath = gzipPath
        } catch (error) {
          if (backup) {
            stderr.write(
              ansis.yellow(
                `🛢️ Wrote backup to ${filePath} but failed to compress: ${error instanceof Error ? error.message : String(error)}\n`,
              ),
            )
          } else {
            stderr.write(
              ansis.red(
                `🛢️ Wrote seed to ${filePath} but failed to compress: ${error instanceof Error ? error.message : String(error)}\n`,
              ),
            )
            return 2
          }
        }
      }
    }

    if (!quiet) {
      stdout.write(ansis.blue(`🛢️ Successfully dumped contents of the DB in container '${container}' to ${filePath}.\n`))
    }

    return result.exitCode
  }
}

export class DBResetCommand extends JoltCommand {
  static paths = [['db', 'reset']]
  requiredCommands = ['docker', 'compose']
  quiet = Option.Boolean('--quiet, -q', false, { description: 'Suppress status output' })

  async command(): Promise<number | undefined> {
    const {
      config,
      cli,
      context,
      context: { stdout, stderr },
      quiet,
    } = this

    if (!quiet) {
      stdout.write(ansis.blue('🛢️ Backing up current database...\n'))
    }

    const backupResult = await cli.run(['db', 'dump', '--backup'], context)

    if (backupResult > 0) {
      stderr.write(ansis.red('🛢️ Failed to backup database!\n'))
      return backupResult
    }

    const [composeCommand, args] = await config.getComposeCommand()
    if (!quiet) {
      stdout.write(ansis.blue('🛢️ Bringing containers down...\n'))
    }

    await execC(composeCommand, [...args, 'down'], { context })

    const composeConfig = await config.getComposeConfig()
    const services = composeConfig?.services
    const volumes = composeConfig?.volumes

    if (!composeConfig || !services || !volumes) {
      stderr.write(ansis.red('🛢️ Failed to get compose config!\n'))
      return 1
    }

    const [dbConfig, cacheConfig] = await Promise.all([config.getDBContainerInfo(), config.getCacheContainerInfo()])
    const dbVolumes = dbConfig?.service.volumes || []
    const cacheVolumes = cacheConfig?.service.volumes || []
    const volumesToDelete = [...dbVolumes, ...cacheVolumes]
      .filter((x) => x.type === 'volume')
      .map((x) => x.source || '')
    const fullVolumeNames = []

    if (volumesToDelete.length > 0) {
      for (const volume of volumesToDelete) {
        if (!volumes[volume]) {
          stderr.write(ansis.red(`🛢️ Missing volume config in compose file for volume '${volume}'!\n`))
          return 2
        }

        fullVolumeNames.push(volumes[volume].name)
      }

      if (!quiet) {
        stdout.write(ansis.blue(`🛢️ Deleting the following volumes: ${fullVolumeNames.join(', ')}\n`))
      }

      await execC(await config.command('docker'), ['volume', 'rm', ...fullVolumeNames], {
        stdout: 'ignore',
        stderr,
        reject: false,
      })

      if (!quiet) {
        stdout.write(ansis.blue('🛢️ Deleted volumes.\n'))
      }
    } else if (!quiet) {
      stdout.write(ansis.yellow(`🛢️ Didn't find any DB or cache volumes to delete. Maybe there's a config issue?\n`))
    }

    if (!quiet) {
      stdout.write(ansis.blue('🛢️ Bringing containers back up...\n'))
    }

    await execC(composeCommand, [...args, 'up', '--detach'], { context })
    const devPlugins = await await config.get('devPlugins')

    if (devPlugins) {
      const devPluginDelay = await config.get('devPluginDelay')
      let delaySeconds = Number.parseFloat(devPluginDelay || '5')

      if (Number.isNaN(delaySeconds)) {
        if (!quiet) {
          stdout.write(
            ansis.yellow(`🛢️ Unreadable devPluginDelay config value "${devPluginDelay}". Defaulting to 5 seconds.\n`),
          )
        }

        delaySeconds = 5
      }

      if (delaySeconds > 0) {
        const delayMs = delaySeconds * 1000

        if (!quiet) {
          stdout.write(ansis.blue(`🛢️ Waiting for ${delaySeconds} seconds for DB to populate...\n`))
        }

        await delay(delayMs)
      }

      if (!quiet) {
        stdout.write(ansis.blue('🛢️ Activating dev plugins...\n'))
      }

      await cli.run(['wp', 'plugin', 'activate', ...devPlugins.split(',').map((x) => x.trim())], context)

      if (!quiet) {
        stdout.write(ansis.blue('🛢️ Done resetting DB!\n'))
      }

      return 0
    }
  }
}

export class DBAwaitCommand extends JoltCommand {
  static paths = [['db', 'await']]
  requiredCommands = ['docker', 'compose']

  quiet = Option.Boolean('--quiet, -q', false, { description: 'Suppress status output' })

  timeout = Option.String('--timeout, -t', '300', {
    tolerateBoolean: false,
    validator: t.cascade(t.isNumber(), t.isPositive(), t.isInteger()),
    description: 'Timeout in seconds to wait for database availability',
  })

  target = Option.String({ required: false })

  async command(): Promise<number | undefined> {
    const {
      config,
      target,
      timeout,
      quiet,
      context: { stdout, stderr },
    } = this

    const endTime = Date.now() + timeout * 1000
    const realTarget = target || (await config.getDBContainerInfo())?.name
    const info = await config.getDBContainerInfo(realTarget)

    if (!realTarget || !info) {
      stderr.write(ansis.red(`🛢️ Unable to find info for DB ${realTarget}.\n`))
      return 1
    }

    if (!quiet) {
      stdout.write(ansis.blue(`🛢️ Waiting for DB container ${realTarget} to finish loading...\n`))
    }

    const [composeCommand, args] = await config.getComposeCommand()

    while (Date.now() <= endTime) {
      const result = await execC(
        composeCommand,
        [
          ...args,
          'exec',
          info.name,
          info.adminCommand,
          '-h',
          '127.0.0.1',
          '-u',
          info.credentials.user,
          `-p${info.credentials.pass}`,
          'ping',
        ],
        {
          reject: false,
          shell: false,
          timeout: endTime - Date.now(),
        },
      )

      if (result.exitCode === 0) {
        if (!quiet) {
          stdout.write(ansis.blue(`\n🛢️ DB container ${realTarget} is loaded.\n`))
        }

        return 0
      }

      await delay(1000)
    }

    stderr.write(ansis.red(`🛢️ Timed out waiting for DB container ${realTarget} for ${timeout} seconds.\n`))
    return 2
  }
}
