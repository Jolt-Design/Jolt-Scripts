import ansis from 'ansis'
import { Option } from 'clipanion'
import { DockerBuildCommand } from './Docker.js'
import JoltCommand from './JoltCommand.js'

export class BuildCommand extends JoltCommand {
  static paths = [['build']]

  dev = Option.Boolean('--dev', false)
  prod = Option.Boolean('--prod', true)

  async command(): Promise<number | undefined> {
    const {
      config,
      context,
      context: { stdout, stderr },
      dev,
    } = this

    const imageName = config.get('imageName')

    if (imageName) {
      stdout.write(
        ansis.yellow(`Found a configured image name (${imageName}) - assuming you wanted to build Docker.\n\n`),
      )

      const args = ['build', 'docker']
      args.push(dev ? '--dev' : '--prod')
      return await this.cli.run(args, context)
    }

    stderr.write(this.cli.usage(DockerBuildCommand))
    return 1
  }
}
