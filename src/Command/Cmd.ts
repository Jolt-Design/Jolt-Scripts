import ansis from 'ansis'
import { Command, Option } from 'clipanion'
import { execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'

export class CmdCommand extends JoltCommand {
  static paths = [['cmd']]

  static usage = Command.Usage({
    category: 'Utilities',
    description: 'Run a shell command after resolving {type:variable} placeholders in its arguments',
    details: `
      Everything after \`cmd\` is the command. \`-q\`/\`--quiet\` and \`-c\`/\`--cwd\` are only recognised before the
      command itself. Placeholders such as \`{tf:cluster_name}\` or \`{config:imageName}\` are resolved first, and
      secrets are redacted from the echoed command line. The command runs in a shell.
    `,
    examples: [
      ['Run a command in a subfolder', '$0 cmd --cwd code yarn install'],
      ['Use a Terraform output', '$0 cmd echo {tf:cluster_name}'],
    ],
  })

  cwd = Option.String('-c,--cwd', { required: false, description: 'Working directory to run the command in' })
  quiet = Option.Boolean('-q,--quiet', false, { description: 'Suppress command execution output' })
  args = Option.Proxy()

  getProxyArgs(): string[] {
    return this.args
  }

  async command(): Promise<number | undefined> {
    const {
      args,
      config,
      context,
      context: { stdout },
    } = this

    // See: https://github.com/arcanis/clipanion/issues/85
    const parsedArgs = await Promise.all(args.map((x) => config.parseArg(x)))
    let quiet = false
    let cwdArg: string | undefined
    let i = 0

    // Parse custom options: -q/--quiet and -c/--cwd
    while (i < parsedArgs.length) {
      const arg = parsedArgs[i]

      if (['-q', '--quiet'].includes(arg)) {
        quiet = true
        i++
      } else if (['-c', '--cwd'].includes(arg)) {
        // Short or long two-part form: -c x/y or --cwd x/y
        cwdArg = parsedArgs[i + 1]
        i += 2
      } else if (arg?.match(/^--cwd=/)) {
        // Long one-part form: --cwd=x/y
        cwdArg = arg.replace(/^--cwd=/, '')
        i++
      } else {
        break
      }
    }

    const commandArgs = parsedArgs.slice(i)

    if (!quiet) {
      stdout.write(ansis.blue(`Running command: ${config.redact(commandArgs.join(' '))}...\n`))
    }

    const result = await execC(commandArgs[0], commandArgs.slice(1), { cwd: cwdArg, context, shell: true })
    return result.exitCode
  }
}
