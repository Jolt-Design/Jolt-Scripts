import { userInfo } from 'node:os'
import ansis from 'ansis'
import { Option } from 'clipanion'
import { execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'

export class WPCommand extends JoltCommand {
  static paths = [['wp'], ['wp-cli']]

  wpArgs = Option.Proxy()

  async command(): Promise<number | undefined> {
    const {
      config,
      context,
      context: { stderr },
    } = this

    const containerName = await this.getContainerName()

    if (!containerName) {
      stderr.write(ansis.red(`Couldn't find a WP CLI container. Set it with the 'wpCliContainer' config key.\n`))
      return 1
    }

    const { uid, gid } = userInfo()
    // On Windows, uid is -1 so we shouldn't try to set the user
    const userArg = uid !== undefined && uid !== -1 && `--user='${uid}:${gid}'`
    const profile = await this.getContainerProfile(containerName)
    const [composeCommand, args] = await config.getComposeCommand()

    args.push(profile ? `--profile=${profile}` : '', 'run', '--rm', userArg || '', containerName, 'wp', ...this.wpArgs)
    const parsedArgs = await Promise.all(args.map((x) => config.parseArg(x)))

    const result = await execC(composeCommand, parsedArgs, { context, reject: false })
    return result.exitCode
  }

  async getContainerName(): Promise<string | undefined> {
    const { config } = this

    if (config.has('wpCliContainer')) {
      return await config.get('wpCliContainer')
    }

    const composeConfig = await config.getComposeConfig()

    if (!composeConfig) {
      return undefined
    }

    for (const [key, service] of Object.entries(composeConfig.services)) {
      if (service.image?.match(/\bwp[_-]?cli\b/i)) {
        return key
      }
    }
  }

  async getContainerProfile(container: string): Promise<string | undefined> {
    const { config } = this

    if (config.has('wpCliContainerProfile')) {
      return await config.get('wpCliContainerProfile')
    }

    const composeConfig = await config.getComposeConfig()

    if (!composeConfig) {
      return undefined
    }

    const service = composeConfig.services[container]
    return service.profiles ? service.profiles[0] : undefined
  }
}
