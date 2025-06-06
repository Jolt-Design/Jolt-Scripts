import ansis from 'ansis'
import { Option } from 'clipanion'
import { execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'

export class CmdCommand extends JoltCommand {
  static paths = [['cmd']]

  quiet = Option.Boolean('-q,--quiet', false)
  args = Option.Proxy()

  async command(): Promise<number | undefined> {
    const {
      args,
      config,
      context,
      context: { stdout },
    } = this

    // TODO: Clipanion should pick up the quiet arg properly without this but it isn't for some reason
    const quiet = ['-q', '--quiet'].includes(args[0])
    const cleanedArgs = quiet ? args.slice(1) : args
    const parsedArgs = await Promise.all(cleanedArgs.map((x) => config.parseArg(x)))

    if (!quiet) {
      stdout.write(ansis.blue(`Running command: ${parsedArgs.join(' ')}...\n`))
    }

    const result = await execC(parsedArgs[0], parsedArgs.slice(1), { context, shell: true })
    return result.exitCode
  }
}
