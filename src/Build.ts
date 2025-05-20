import chalk from 'chalk'
import { Command, Option } from 'clipanion'
import shelljs from 'shelljs'
import * as t from 'typanion'
import type { Config } from './Config.js'
import getConfig from './Config.js'
import { execC } from './utils.js'

const { which } = shelljs

export class BuildCommand extends Command {
  static paths = [['build']]

  dev = Option.Boolean('--dev', false)
  prod = Option.Boolean('--prod', true)

  async execute(): Promise<number | undefined> {
    const config = await getConfig()
    const imageName = config.get('imageName')
    const { stdout, stderr } = this.context

    if (imageName) {
      stdout.write(
        chalk.yellow(`Found a configured image name (${imageName}) - assuming you wanted to build Docker.\n\n`),
      )

      return await this.cli.run(['build', 'docker'])
    }

    stderr.write(this.cli.usage(BuildDockerCommand))
    return 1
  }
}

export class BuildDockerCommand extends BuildCommand {
  static paths = [['build', 'docker']]
  static schema = [t.hasMutuallyExclusiveKeys(['--dev', '--prod'])]

  async execute(): Promise<number | undefined> {
    const {
      context,
      context: { stdout, stderr },
    } = this
    const config = await getConfig()
    const imageName = await config.getDockerImageName(this.dev)
    const imageType = this.dev ? 'dev' : this.prod ? 'prod' : 'unknown'
    const dockerCommand = config.command('docker')

    if (!imageName) {
      stderr.write(chalk.red('Image name must be configured!\n'))
      return 1
    }

    if (!which(dockerCommand)) {
      stderr.write(chalk.red(`Could not find command ${dockerCommand}!\n`))
      return 2
    }

    stdout.write(chalk.blue(`🐳 Building image ${imageName} for ${imageType} using ${dockerCommand}...\n`))

    const args = this.buildArgs(config)
    const command = [dockerCommand, ...args].join(' ')
    stdout.write(`Running command: ${command}\n`)

    const result = await execC(dockerCommand, args, { context })

    return result.exitCode
  }

  buildArgs(config: Config): string[] {
    const imageName = config.get('imageName')
    const platform = config.get('buildPlatform')
    const context = config.get('buildContext')
    const dockerFile = config.get('dockerFile')
    const isDev = this.dev
    const buildSuffix = isDev ? '-dev' : ''
    const buildArgs = isDev ? '--build-arg=DEVBUILD=1' : ''

    return [
      'buildx',
      'build',
      platform && `--platform=${platform}`,
      dockerFile && `-f ${dockerFile}`,
      `-t ${imageName}${buildSuffix}`,
      buildArgs,
      context ?? '.',
    ]
      .filter((x) => !!x)
      .map(String)
  }
}
