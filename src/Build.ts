import { Command, Option } from 'clipanion'

export class BuildCommand extends Command {
  static paths = [['build']]

  async execute(): Promise<number | undefined> {
    this.context.stdout.write('Building')

    return
  }
}
