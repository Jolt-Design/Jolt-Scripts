import { Option } from 'clipanion'
import JoltCommand from './JoltCommand.js'
import ansis from 'ansis'
import { execa } from 'execa'
import path from 'node:path'
import shelljs from 'shelljs'
import { execC } from '../utils.js'
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

    const backupPath = config.get('dbBackupPath')

    let filename: string
    let shouldGzip = backup

    if (backup) {
      if (!backupPath) {
        stderr.write(ansis.red('The DB backup location must be configured as dbBackupPath.\n'))
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
      const configSeed = config.get('dbSeed')

      if (!configSeed) {
        stderr.write(ansis.red('The DB seed location must be configured.\n'))
        return 1
      }

      filename = configSeed
    }

    const [composeCommand, args] = config.getComposeCommand()
    const containerInfo = await config.getDBContainerInfo()

    if (!containerInfo) {
      stderr.write(ansis.red(`Couldn't find information about database container. Try setting config explicitly.\n`))
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
