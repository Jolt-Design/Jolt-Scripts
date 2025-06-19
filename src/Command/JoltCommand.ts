import ansis from 'ansis'
import { Command, Option } from 'clipanion'
import shelljs from 'shelljs'
import type { Config } from '../Config.js'
import getConfig from '../Config.js'

const { which } = shelljs

export default abstract class JoltCommand extends Command {
  logo = ansis.magentaBright('⚡')
  config!: Config
  requiredCommands: string[] = []
  site = Option.String('-s,--site', { required: false })

  abstract command(): Promise<number | undefined>

  getHeader(suffix = '') {
    const header = ansis.whiteBright(`${this.logo} ${this.cli.binaryLabel}`)
    return [header, suffix, '\n\n'].filter((x) => !!x).join(' ')
  }

  async execute(): Promise<number | undefined> {
    const { stderr } = this.context
    const config = await getConfig()

    if (this.site) {
      config.setSite(this.site)
    }

    this.config = config

    if (this.requiredCommands && !process.env.JOLT_IGNORE_REQUIRED_COMMANDS) {
      const missingCommands = []

      for (const baseCommand of this.requiredCommands) {
        const realCommand = await config.command(baseCommand)

        if (!which(realCommand)) {
          missingCommands.push(realCommand)
        }
      }

      if (missingCommands.length > 0) {
        stderr.write(this.getHeader())
        stderr.write(ansis.red('Missing the following commands:\n'))

        for (const missingCommand of missingCommands) {
          stderr.write(ansis.red(`- ${missingCommand}\n`))
        }

        stderr.write('\n\nSee `jolt config` for more information.\n')
        return 4
      }
    }

    return await this.command()
  }
}
