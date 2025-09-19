import ansis from 'ansis'
import { execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'

export class CacheFlushCommand extends JoltCommand {
  static paths = [
    ['cache', 'flush'],
    ['cache', 'clean'],
    ['cache', 'clear'],
  ]

  requiredCommands = ['docker', 'compose']

  async command(): Promise<number | undefined> {
    const {
      config,
      context,
      context: { stdout, stderr },
    } = this

    const [composeCommand, args] = await config.getComposeCommand()
    const cacheInfo = await config.getCacheContainerInfo()

    if (!cacheInfo) {
      stderr.write(ansis.red("🗃️ Couldn't find a configured cache container.\n"))
      return 1
    }

    const { name: container, cliCommand } = cacheInfo
    stdout.write(ansis.blue(`🗃️ Clearing cache in container '${container}' using the ${cliCommand} command.\n`))
    args.push('exec', container, cliCommand, 'flushall')
    const result = await execC(composeCommand, args, { context })
    stdout.write(ansis.blue('🗃️ Cache cleared.\n'))
    return result.exitCode
  }
}
