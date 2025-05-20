import chalk from 'chalk'
import { Option } from 'clipanion'
import { stderr } from 'node:process'
import shelljs from 'shelljs'
import * as t from 'typanion'
import JoltCommand from './JoltCommand.js'
const { which } = shelljs

enum ConfigCommandFormat {
  Pretty = 'pretty',
  Json = 'json',
}

export class ConfigCommand extends JoltCommand {
  static paths = [['config']]

  format: ConfigCommandFormat | undefined = Option.String('--format', {
    required: false,
    validator: t.isEnum(ConfigCommandFormat),
  })

  commands = ['aws', 'docker', 'docker-compose', 'node', 'ssh', 'tofu', 'yarn']

  async command(): Promise<number | undefined> {
    const {
      config,
      format,
      context: { stdout },
    } = this

    if (format === undefined || format === ConfigCommandFormat.Pretty) {
      stdout.write(chalk.bold.whiteBright(this.getHeader('Config')))

      await this.listCommands()
      stdout.write('\n')
      await this.listConfig()
      return 0
    }

    if (format === ConfigCommandFormat.Json) {
      stderr.write(`${config.asJson()}\n`)
      return 0
    }

    stderr.write(chalk.red(`Unknown format "${format}"\n`))
    return 1
  }

  async listCommands() {
    const {
      config,
      commands,
      context: { stdout },
    } = this

    stdout.write(chalk.bold.blue('Commands:\n'))

    for (const commandName of commands) {
      const { command, source, sourceType } = config.getCommandOverride(commandName)

      stdout.write(chalk.bold(`${commandName}: `))

      if (which(command)) {
        stdout.write(chalk.green(command))
      } else {
        stdout.write(chalk.red(`${command} ${chalk.bold('[Missing!]')}`))
      }

      let sourceString = ''

      switch (sourceType) {
        case 'env':
          sourceString = `[Env var: ${source}]`
          break
        case 'config':
          sourceString = `[Config: ${source}]`
          break
      }

      if (sourceString) {
        stdout.write(` ${chalk.gray(sourceString)}`)
      }

      stdout.write('\n')
    }
  }

  async listConfig() {
    const {
      config,
      context: { stdout },
    } = this

    const sourceString = config.configPath ? chalk.dim(`[Source file: ${config.configPath}]`) : ''
    stdout.write(chalk.bold.blue(`Config: ${sourceString}\n`))

    for (const [key, value] of config) {
      stdout.write(chalk.bold(`${key}: `))
      stdout.write(`${value}\n`)
    }
  }
}
