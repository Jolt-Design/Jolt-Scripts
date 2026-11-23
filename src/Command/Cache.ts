import ansis from 'ansis'
import { Command } from 'clipanion'
import { execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'

export class CacheFlushCommand extends JoltCommand {
  static paths = [
    ['cache', 'flush'],
    ['cache', 'clean'],
    ['cache', 'clear'],
  ]

  static usage = Command.Usage({
    category: 'Local development',
    description: 'Flush the Redis/Valkey cache in the local Docker Compose stack',
    details: `
      Finds the Redis or Valkey service in the Compose config and runs \`flushall\` in it. Also available as
      \`cache clean\` and \`cache clear\`.

      Requires docker and compose. Exits 1 if no cache container is found.
    `,
    examples: [['Flush the local cache', '$0 cache flush']],
  })

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
