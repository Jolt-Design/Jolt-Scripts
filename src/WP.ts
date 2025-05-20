import chalk from 'chalk'
import { Command, Option } from 'clipanion'
import getConfig from './Config.js'
import { execC } from './utils.js'
import { userInfo } from 'node:os'

export class WPCommand extends Command {
  static paths = [['wp'], ['wp-cli']]

  wpArgs = Option.Proxy()

  async execute(): Promise<number | undefined> {
    const config = await getConfig()
    const {
      context,
      context: { stderr },
    } = this

    const containerName = await this.getContainerName()

    if (!containerName) {
      stderr.write(chalk.red(`Couldn't find a WP CLI container. Set it with the 'wpCliContainer' config key.\n`))
      return 1
    }

    const { uid, gid } = userInfo()
    // On Windows, uid is -1 so we shouldn't try to set the user
    const userArg = uid !== undefined && uid !== -1 && `--user='${uid}:${gid}'`
    const profile = await this.getContainerProfile(containerName)
    const args = [
      profile ? `--profile=${profile}` : '',
      'run',
      '--rm',
      userArg || '',
      containerName,
      'wp',
      ...this.wpArgs,
    ]
    const result = await execC(config.command('docker compose'), args, { context, reject: false })
    return result.exitCode
  }

  async getContainerName(): Promise<string | undefined> {
    const config = await getConfig()

    if (config.has('wpCliContainer')) {
      return config.get('wpCliContainer')
    }

    const composeConfig = await config.getComposeConfig()

    if (!composeConfig) {
      return undefined
    }

    for (const [key, service] of Object.entries(composeConfig.services)) {
      if (service.image?.match(/\bwp[_-]cli\b/i)) {
        return key
      }
    }
  }

  async getContainerProfile(container: string): Promise<string | undefined> {
    const config = await getConfig()

    if (config.has('wpCliContainerProfile')) {
      return config.get('wpCliContainerProfile')
    }

    const composeConfig = await config.getComposeConfig()

    if (!composeConfig) {
      return undefined
    }

    const service = composeConfig.services[container]
    return service.profiles ? service.profiles[0] : undefined
  }
}
