import { stderr } from 'node:process'
import ansis from 'ansis'
import { Option } from 'clipanion'
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

  commands = ['aws', 'compose', 'docker', 'git', 'gzip', 'node', 'rsync', 'ssh', 'tofu', 'yarn']

  async command(): Promise<number | undefined> {
    const {
      config,
      format,
      context: { stdout },
    } = this

    if (format === undefined || format === ConfigCommandFormat.Pretty) {
      stdout.write(ansis.bold.whiteBright(this.getHeader('Config')))

      await this.listCommands()
      stdout.write('\n')
      await this.listConfig()
      return 0
    }

    if (format === ConfigCommandFormat.Json) {
      stdout.write(`${config.asJson()}\n`)
      return 0
    }

    stderr.write(ansis.red(`Unknown format "${format}"\n`))
    return 1
  }

  async listCommands() {
    const {
      config,
      commands,
      context: { stdout },
    } = this

    stdout.write(ansis.bold.blue('Commands:\n'))

    for (const commandName of commands) {
      const { command, source, sourceType } = await config.getCommandOverride(commandName)

      stdout.write(ansis.bold(`${commandName}: `))

      if (which(command)) {
        stdout.write(ansis.green(command))
      } else {
        stdout.write(ansis.red(`${command} ${ansis.bold('[Missing!]')}`))
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
        stdout.write(` ${ansis.gray(sourceString)}`)
      }

      stdout.write('\n')
    }
  }

  async listConfig() {
    const {
      config,
      context: { stdout },
    } = this

    const sourceString = config.configPath ? ansis.dim(`[Source file: ${config.configPath}]`) : ''
    stdout.write(ansis.bold.blue(`Config: ${sourceString}\n`))

    for (const [key, value] of config) {
      const parsedValue = await config.parseArg(value)

      stdout.write(ansis.bold(`${key}: `))
      stdout.write(`${parsedValue}`)

      if (parsedValue !== value) {
        stdout.write(ansis.dim(` [Parsed from: ${value}]`))
      }

      stdout.write('\n')
    }
  }
}
