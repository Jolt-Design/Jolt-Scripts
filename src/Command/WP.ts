import { userInfo } from 'node:os'
import ansis from 'ansis'
import { Option } from 'clipanion'
import { execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'

// Possible sub-arguments for the CLI command as of WP-CLI v2.12.0
const possibleCliArgs = [
  'alias',
  'cache',
  'check-update',
  'cmd-dump',
  'completions',
  'has-command',
  'info',
  'param-dump',
  'update',
  'version',
]

let maybeAddCliArg = true

export class WPCommand extends JoltCommand {
  static paths = [['wp']]
  wpArgs = Option.Proxy()

  async command(): Promise<number | undefined> {
    const { cli, wpArgs } = this

    // Proxy to wp-cli for backwards compatibility
    maybeAddCliArg = false
    const result = await cli.run(['wp-cli', ...wpArgs])
    maybeAddCliArg = true

    return result
  }
}

export class WPCLICommand extends JoltCommand {
  static paths = [['wp', 'cli'], ['wp-cli']]
  requiredCommands = ['docker', 'compose']

  wpArgs = Option.Proxy()

  async command(): Promise<number | undefined> {
    const {
      config,
      context,
      context: { stderr },
      wpArgs,
    } = this

    const containerName = await this.getContainerName()
    let realArgs = wpArgs

    if (maybeAddCliArg && possibleCliArgs.includes(realArgs[0])) {
      realArgs = ['cli', ...realArgs]
    }

    if (!containerName) {
      stderr.write(ansis.red(`Couldn't find a WP CLI container. Set it with the 'wpCliContainer' config key.\n`))
      return 1
    }

    const { uid, gid } = userInfo()
    // On Windows, uid is -1 so we shouldn't try to set the user
    const userArg = uid !== undefined && uid !== -1 && `--user='${uid}:${gid}'`
    const profile = await this.getContainerProfile(containerName)
    const [composeCommand, args] = await config.getComposeCommand()

    args.push(profile ? `--profile=${profile}` : '', 'run', '--rm', userArg || '', containerName, 'wp', ...realArgs)
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
