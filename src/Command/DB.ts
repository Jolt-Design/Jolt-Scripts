import { Option } from 'clipanion'
import JoltCommand from './JoltCommand.js'
import ansis from 'ansis'
import { execa } from 'execa'
import path from 'node:path'
import shelljs from 'shelljs'
const { which } = shelljs

type DBContainerInfo = {
  name: string | undefined
  dumpCommand: string | undefined
  credentials: {
    db: string | undefined
    user: string | undefined
    pass: string | undefined
  }
}

const dbImageRegex = /\b(?<type>mysql|mariadb)\b/i

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

    let composeCommand = config.command('docker compose')
    const containerInfo = await this.getContainerInfo()

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

    const args: string[] = [
      'exec',
      container || '',
      dumpCommand || '',
      '--skip-add-drop-table',
      '-u',
      credentials.user || '',
      `-p${credentials.pass}`,
      credentials.db || '',
    ]

    // If the command is a subcommand, like `docker compose`, we need to shift the compose part into the args array
    if (composeCommand.includes(' ')) {
      const parts = composeCommand.split(' ')
      composeCommand = parts[0]
      args.unshift(...parts.slice(1))
    }

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

  async getContainerInfo(): Promise<DBContainerInfo | undefined> {
    const { config } = this
    const result: Partial<DBContainerInfo> = {}
    const composeConfig = await config.getComposeConfig()
    const services = composeConfig?.services

    if (config.has('dbContainer')) {
      result.name = config.get('dbContainer') as string
    } else if (services) {
      for (const [serviceName, service] of Object.entries(services)) {
        const match = service.image?.match(dbImageRegex)

        if (match) {
          result.name = serviceName
          result.dumpCommand = this.getDumpCommandFromImageType(match.groups?.type as string)
          result.credentials = {
            db: service.environment?.DB_NAME,
            user: service.environment?.DB_USER,
            pass: service.environment?.DB_PASS,
          }
        }
      }
    }

    if (!result.name) {
      return
    }

    if (config.has('dbDumpCommand')) {
      result.dumpCommand = config.get('dbDumpCommand')
    } else if (services) {
      const image = services[result.name]?.image

      if (image) {
        const match = image.match(dbImageRegex)
        result.dumpCommand = this.getDumpCommandFromImageType(match?.groups?.type as string)
      }
    }

    if (!result.dumpCommand) {
      return
    }

    if (!result.credentials) {
      result.credentials = {
        db: undefined,
        user: undefined,
        pass: undefined,
      }
    }

    if (config.has('dbName')) {
      result.credentials.db = config.get('dbName')
    }

    if (config.has('dbUser')) {
      result.credentials.user = config.get('dbUser')
    }

    if (config.has('dbPass')) {
      result.credentials.pass = config.get('dbPass')
    }

    if (Object.values(result.credentials).findIndex((x) => x === undefined) !== -1) {
      return
    }

    return result as DBContainerInfo
  }

  getDumpCommandFromImageType(type: string): string | undefined {
    switch (type) {
      case 'mysql':
        return 'mysqldump'
      case 'mariadb':
        return 'mariadb-dump'
    }
  }
}
