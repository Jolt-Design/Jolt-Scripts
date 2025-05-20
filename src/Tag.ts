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
      context,
      context: { stdout, stderr },
    } = this
    this.config = await getConfig()

    const dockerCommand = this.config.command('docker')
    const imageName = await this.getImageName()
    const remoteRepo = await this.getRemoteRepo()
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

  async getImageName(): Promise<string | undefined> {
    const { config } = this
    const isDev = this.dev

    if (isDev) {
      if (config.has('devImageName')) {
        return config.get('devImageName')
      }

      const tfDevImageName = await config.tfVar('dev_docker_image_name')

      if (tfDevImageName) {
        return tfDevImageName
      }

      if (config.has('imageName')) {
        return `${config.get('imageName')}-dev`
      }

      const tfImageName = await config.tfVar('docker_image_name')

      if (tfImageName) {
        return `${tfImageName}-dev`
      }

      return undefined
    }

    if (config.has('imageName')) {
      return config.get('imageName')
    }

    const tfImageName = await config.tfVar('docker_image_name')

    if (tfImageName) {
      return tfImageName
    }
  }

  async getRemoteRepo(): Promise<string | undefined> {
    const { config } = this
    const isDev = this.dev

    if (isDev) {
      if (config.has('devRemoteRepo')) {
        return config.get('devRemoteRepo')
      }

      const tfDevEcrRepo = await config.tfVar('dev_ecr_url')

      if (tfDevEcrRepo) {
        return tfDevEcrRepo
      }

      return undefined
    }

    if (config.has('remoteRepo')) {
      return config.get('remoteRepo')
    }

    const tfEcrRepo = await config.tfVar('ecr_url')

    if (tfEcrRepo) {
      return tfEcrRepo
    }
  }
}
