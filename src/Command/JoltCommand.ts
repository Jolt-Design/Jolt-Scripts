import chalk from 'chalk'
import { Command } from 'clipanion'
import type { Config } from '../Config.js'
import getConfig from '../Config.js'

export default abstract class JoltCommand extends Command {
  logo = chalk.magentaBright('⚡')
  config!: Config
  requiredCommands: string[] = []

  abstract command(): Promise<number | undefined>

  getHeader(suffix = '') {
    const header = chalk.whiteBright(`${this.logo} ${this.cli.binaryLabel}`)
    return [header, suffix, '\n\n'].filter((x) => !!x).join(' ')
  }

  async execute(): Promise<number | undefined> {
    this.config = await getConfig()
    return await this.command()
  }
}
