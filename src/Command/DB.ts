import path from 'node:path'
import ansis from 'ansis'
import { Option } from 'clipanion'
import { execa } from 'execa'
import shelljs from 'shelljs'
import { delay, execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'

const { which } = shelljs

export class DBDumpCommand extends JoltCommand {
  static paths = [['db', 'dump']]
  requiredCommands = ['docker']
  backup = Option.Boolean('--backup', false)

  async command(): Promise<number | undefined> {
    const {
      backup,
      config,
      context: { stdout, stderr },
    } = this

    const backupPath = await config.get('dbBackupPath')

    let filename: string
    let shouldGzip = backup

    if (backup) {
      if (!backupPath) {
        stderr.write(ansis.red('🛢️ The DB backup location must be configured as dbBackupPath.\n'))
        return 1
      }

      const now = new Date()
      const date = now
        .toISOString()
        .replace('T', '_')
        .replace(/:/g, '-')
        .replace(/\.\d+Z.*$/, '')

      filename = `backup-${date}.sql`
    } else {
      const configSeed = await config.get('dbSeed')

      if (!configSeed) {
        stderr.write(ansis.red('🛢️ The DB seed location must be configured.\n'))
        return 1
      }

      filename = configSeed
    }

    const [composeCommand, args] = await config.getComposeCommand()
    const containerInfo = await config.getDBContainerInfo()

    if (!containerInfo) {
      stderr.write(ansis.red(`🛢️ Couldn't find information about database container. Try setting config explicitly.\n`))
      return 2
    }

    const { name: container, dumpCommand, credentials } = containerInfo
    let filePath = backup ? path.resolve(backupPath as string, filename) : path.resolve(filename)

    if (filePath.endsWith('.gz')) {
      shouldGzip = true
      filePath = filePath.replace(/\.gz$/, '')
    }

    stdout.write(ansis.blue(`🛢️ Dumping contents of the DB in container '${container}' to ${filePath}...\n`))

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

    const result = await execa(composeCommand, args, {
      buffer: { stdout: false },
      stderr,
      stdout: { file: filePath },
    })

    if (shouldGzip) {
      if (which('gzip')) {
        stderr.write(ansis.blue('🛢️ Gzipping file...\n'))
        const gzipResult = await execa('gzip', ['--force', filePath], { stdout, stderr })
        filePath = `${filePath}.gz`
      } else {
        if (backup) {
          stderr.write(
            ansis.yellow(
              `🛢️ Wrote backup to ${filePath} but couldn't find gzip. Install gzip to automatically compress backups.\n`,
            ),
          )
        } else {
          stderr.write(
            ansis.red(`🛢️ Wrote seed to ${filePath} but gzip is missing. Install gzip to compress the DB seed.\n`),
          )
          return 2
        }
      }
    }

    stdout.write(ansis.blue(`🛢️ Successfully dumped contents of the DB in container '${container}' to ${filePath}.\n`))

    return result.exitCode
  }
}

export class DBResetCommand extends JoltCommand {
  static paths = [['db', 'reset']]
  requiredCommands = ['docker']

  async command(): Promise<number | undefined> {
    const {
      config,
      cli,
      context,
      context: { stdout, stderr },
    } = this

    stdout.write(ansis.blue('🛢️ Backing up current database...\n'))
    const backupResult = await cli.run(['db', 'dump', '--backup'], context)

    if (backupResult > 0) {
      stderr.write(ansis.red('🛢️ Failed to backup database!\n'))
      return backupResult
    }

    const [composeCommand, args] = await config.getComposeCommand()
    stdout.write(ansis.blue('🛢️ Bringing containers down...\n'))
    const dcDownResult = await execC(composeCommand, [...args, 'down'], { context })

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

      stdout.write(ansis.blue(`🛢️ Deleting the following volumes: ${fullVolumeNames.join(', ')}\n`))
      const volumeDeleteResult = await execC(await config.command('docker'), ['volume', 'rm', ...fullVolumeNames], {
        stdout: 'ignore',
        stderr,
        reject: false,
      })
      stdout.write(ansis.blue('🛢️ Deleted volumes.\n'))
    } else {
      stdout.write(ansis.yellow(`🛢️ Didn't find any DB or cache volumes to delete. Maybe there's a config issue?\n`))
    }

    stdout.write(ansis.blue('🛢️ Bringing containers back up...\n'))
    const dcUpResult = await execC(composeCommand, [...args, 'up', '--detach'], { context })
    const devPlugins = await await config.get('devPlugins')

    if (devPlugins) {
      const devPluginDelay = await config.get('devPluginDelay')
      let delaySeconds = Number.parseFloat(devPluginDelay || '5')

      if (Number.isNaN(delaySeconds)) {
        stdout.write(
          ansis.yellow(`🛢️ Unreadable devPluginDelay config value "${devPluginDelay}". Defaulting to 5 seconds.\n`),
        )
        delaySeconds = 5
      }

      if (delaySeconds > 0) {
        const delayMs = delaySeconds * 1000
        stdout.write(ansis.blue(`🛢️ Waiting for ${delaySeconds} seconds for DB to populate...\n`))
        await delay(delayMs)
      }

      stdout.write(ansis.blue('🛢️ Activating dev plugins...\n'))
      await cli.run(['wp', 'plugin', 'activate', ...devPlugins.split(',').map((x) => x.trim())], context)

      stdout.write(ansis.blue('🛢️ Done resetting DB!\n'))
      return 0
    }
  }
}
