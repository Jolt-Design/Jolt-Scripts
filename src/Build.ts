import chalk from 'chalk'
import { Command, Option } from 'clipanion'
import getConfig from './Config.js'
import { DockerBuildCommand } from './Docker.js'

export class BuildCommand extends Command {
  static paths = [['build']]

  dev = Option.Boolean('--dev', false)
  prod = Option.Boolean('--prod', true)

  async execute(): Promise<number | undefined> {
    const config = await getConfig()
    const imageName = config.get('imageName')
    const {
      context,
      context: { stdout, stderr },
      dev,
    } = this

    if (imageName) {
      stdout.write(
        chalk.yellow(`Found a configured image name (${imageName}) - assuming you wanted to build Docker.\n\n`),
      )

      const args = ['build', 'docker']
      args.push(dev ? '--dev' : '--prod')
      return await this.cli.run(args, context)
    }

    stderr.write(this.cli.usage(DockerBuildCommand))
    return 1
  }
}
