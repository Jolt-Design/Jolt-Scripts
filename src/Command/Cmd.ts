import ansis from 'ansis'
import { Option } from 'clipanion'
import { execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'

export class CmdCommand extends JoltCommand {
  static paths = [['cmd']]

  cwd = Option.String('-c,--cwd', { required: false, description: 'Working directory to run the command in' })
  quiet = Option.Boolean('-q,--quiet', false, { description: 'Suppress command execution output' })
  args = Option.Proxy()

  async command(): Promise<number | undefined> {
    const {
      args,
      config,
      context,
      context: { stdout },
    } = this

    // See: https://github.com/arcanis/clipanion/issues/85
    const parsedArgs = await Promise.all(args.map((x) => config.parseArg(x)))
    let proxyArgs = parsedArgs
    let quiet = false
    let parsingCwd = false
    let cwdArg: string | undefined

    // Horrible custom arg parsing
    while (true) {
      if (parsingCwd) {
        cwdArg = proxyArgs[0]
        parsingCwd = false
        proxyArgs = proxyArgs.slice(1)
      } else if (['-q', '--quiet'].includes(proxyArgs[0])) {
        quiet = true
        proxyArgs = proxyArgs.slice(1)
      } else if (['-c', '--cwd'].includes(proxyArgs[0])) {
        // This is a short cwd arg or two part cwd arg, e.g. `-c x/y` or `--cwd x/y`
        parsingCwd = true
        proxyArgs = proxyArgs.slice(1)
      } else if (proxyArgs[0]?.match(/^--cwd=/)) {
        // This is a one part long cwd arg, e.g. `--cwd=x/y`
        cwdArg = proxyArgs[0].replace(/^--cwd=/, '')
        proxyArgs = proxyArgs.slice(1)
      } else {
        break
      }
    }

    if (!quiet) {
      stdout.write(ansis.blue(`Running command: ${proxyArgs.join(' ')}...\n`))
    }

    const result = await execC(proxyArgs[0], proxyArgs.slice(1), { cwd: cwdArg, context, shell: true })
    return result.exitCode
  }
}
