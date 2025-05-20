import chalk from 'chalk'
import { Option } from 'clipanion'
import { ExecaError, execa } from 'execa'
import shelljs from 'shelljs'
import { execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'
const { which } = shelljs

export abstract class DockerCommand extends JoltCommand {
  requiredCommands = ['docker']

  dev = Option.Boolean('--dev', false)
  prod = !this.dev
}

export class DockerBuildCommand extends DockerCommand {
  static paths = [['docker', 'build']]

  async command(): Promise<number | undefined> {
    const {
      config,
      context,
      context: { stdout, stderr },
      dev,
      prod,
    } = this
    const imageName = await config.getDockerImageName(dev)
    const imageType = dev ? 'dev' : prod ? 'prod' : 'unknown'
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

    const args = await this.buildArgs()
    const command = [dockerCommand, ...args].join(' ')
    stdout.write(`Running command: ${command}\n`)

    const result = await execC(dockerCommand, args, { context })

    return result.exitCode
  }

  async buildArgs(): Promise<string[]> {
    const { config, dev } = this
    const imageName = await config.getDockerImageName(dev)
    const platform = config.get('buildPlatform')
    const context = config.get('buildContext')
    const dockerFile = config.get('dockerFile')
    const buildArgs = dev ? '--build-arg=DEVBUILD=1' : ''

    return [
      'buildx',
      'build',
      platform && `--platform=${platform}`,
      dockerFile && `-f ${dockerFile}`,
      `-t ${imageName}`,
      buildArgs,
      context ?? '.',
    ]
      .filter((x) => !!x)
      .map(String)
  }
}

export class DockerLoginCommand extends DockerCommand {
  static paths = [['docker', 'login']]

  requiredCommands = ['aws', 'docker']

  async command(): Promise<number | undefined> {
    const {
      config,
      context: { stdout, stderr },
    } = this

    // TODO get URL from ecr_repo_url, get region from repo URL
    const ecrBaseUrl = config.get('ecrBaseUrl') ?? (await config.tfVar('ecr_base_url'))
    const region = config.get('awsRegion') ?? (await config.tfVar('region')) ?? config.awsRegion()

    stdout.write(chalk.blue(`🐳 Logging in to ECR repository ${ecrBaseUrl} on ${region}...\n`))

    try {
      const result = await execa(config.command('aws'), ['ecr', 'get-login-password', '--region', region]).pipe(
        config.command('docker'),
        ['login', '--username', 'AWS', '--password-stdin', ecrBaseUrl],
        { stdout, stderr },
      )

      return result.exitCode
    } catch (e) {
      if (e instanceof ExecaError) {
        stderr.write(chalk.red(`Failed to log in! Reason: ${e.message}\n`))
        return e.exitCode
      }

      throw e
    }
  }
}

export class DockerTagCommand extends DockerCommand {
  static paths = [['docker', 'tag']]

  async command(): Promise<number | undefined> {
    const {
      config,
      dev,
      context,
      context: { stdout, stderr },
    } = this
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
