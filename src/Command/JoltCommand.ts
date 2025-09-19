import ansis from 'ansis'
import { Command, Option } from 'clipanion'
import type { Config } from '../Config.js'
import getConfig from '../Config.js'
import { which } from '../utils.js'

export default abstract class JoltCommand extends Command {
  logo = ansis.magentaBright('⚡')
  config!: Config
  requiredCommands: string[] = []
  requiredConfig: string[] = []
  site = Option.String('-s,--site', { required: false })

  abstract command(): Promise<number | undefined>

  /**
   * Override this method to provide dynamic config requirements based on command options
   */
  getRequiredConfig(): string[] {
    return this.requiredConfig
  }
  private async validateRequiredConfig(): Promise<number | undefined> {
    if (process.env.JOLT_IGNORE_REQUIRED_CONFIG) {
      return undefined
    }

    const { stderr } = this.context
    const requiredConfigKeys = this.getRequiredConfig()

    if (!requiredConfigKeys || requiredConfigKeys.length === 0) {
      return undefined
    }

    const missingConfig = []

    for (const configKey of requiredConfigKeys) {
      const configValue = await this.config.get(configKey)

      if (!configValue) {
        missingConfig.push(configKey)
      }
    }

    if (missingConfig.length > 0) {
      stderr.write(this.getHeader())
      stderr.write(ansis.red('Missing the following required config entries:\n'))

      for (const missingConfigKey of missingConfig) {
        stderr.write(ansis.red(`- ${missingConfigKey}\n`))
      }

      stderr.write('\n\nSee `jolt config` for more information.\n')
      return 5
    }

    return undefined
  }

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

        if (!(await which(realCommand))) {
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

    // Config validation will happen in the command wrapper after options are parsed
    return await this.runCommandWithValidation()
  }

  private async runCommandWithValidation(): Promise<number | undefined> {
    // Validate required config after options are parsed
    const configValidationResult = await this.validateRequiredConfig()

    if (configValidationResult !== undefined) {
      return configValidationResult
    }

    return await this.command()
  }
}
