import { Command } from 'clipanion'
import type { Config } from './Config.js'
import getConfig from './Config.js'

export default abstract class JoltCommand extends Command {
  config!: Config

  abstract command(): Promise<number | undefined>

  async execute(): Promise<number | undefined> {
    this.config = await getConfig()
    return await this.command()
  }
}
