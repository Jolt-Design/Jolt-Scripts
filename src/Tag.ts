import chalk from 'chalk'
import { Command, Option } from 'clipanion'
import shelljs from 'shelljs'
import * as t from 'typanion'
import getConfig, { type Config } from './Config.js'
import { execC } from './utils.js'

const { which } = shelljs

export class TagCommand extends Command {
  static paths = [['tag'], ['tag', 'docker']]
  static schema = [t.hasMutuallyExclusiveKeys(['--dev', '--prod'])]

  dev = Option.Boolean('--dev', false)
  prod = Option.Boolean('--prod', true)

  config!: Config

  async execute(): Promise<number | undefined> {
    const {
      dev,
      context,
      context: { stdout, stderr },
    } = this
    const config = await getConfig()
    this.config = config

    const dockerCommand = config.command('docker')
    const imageName = await config.getDockerImageName(dev)
    const remoteRepo = await config.getRemoteRepo(dev)
    const localTag = 'latest'
    const remoteTag = 'latest'

    const args = ['tag', `${imageName}:${localTag}`, `${remoteRepo}:${remoteTag}`]

    if (!imageName) {
      stderr.write(chalk.red('Image name must be configured!\n'))
      return 1
    }

    if (!which(dockerCommand)) {
      stderr.write(chalk.red(`Could not find command ${dockerCommand}!\n`))
      return 2
    }

    stdout.write(chalk.blue(`🐳 Tagging image ${imageName}:${localTag} as ${remoteRepo}:${remoteTag}...\n`))

    // const command = [dockerCommand, ...args].join(' ')
    // stdout.write(`Running command: ${command}\n`)

    const result = await execC(dockerCommand, args, { context })

    return result.exitCode
  }
}
