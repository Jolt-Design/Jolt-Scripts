import { execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'
import ansis from 'ansis'

export class CacheFlushCommand extends JoltCommand {
  static paths = [
    ['cache', 'flush'],
    ['cache', 'clean'],
    ['cache', 'clear'],
  ]

  requiredCommands = ['docker']

  async command(): Promise<number | undefined> {
    const {
      config,
      context,
      context: { stdout, stderr },
    } = this

    const [composeCommand, args] = config.getComposeCommand()
    const cacheInfo = await config.getCacheContainerInfo()

    if (!cacheInfo) {
      stderr.write(ansis.red("🗃️ Couldn't find a configured cache container.\n"))
      return 1
    }

    const { container, cliCommand } = cacheInfo
    stdout.write(ansis.blue(`🗃️ Clearing cache in container '${container}' using the ${cliCommand} command.\n`))
    args.push('exec', container, cliCommand, 'flushall')
    const result = await execC(composeCommand, args, { context })
    stdout.write(ansis.blue('🗃️ Cache cleared.\n'))
    return result.exitCode
  }
}
