import ansis from 'ansis'
import { Command, Option } from 'clipanion'
import { DockerBuildCommand } from './Docker.js'
import JoltCommand from './JoltCommand.js'

export class BuildCommand extends JoltCommand {
  static paths = [['build']]

  static usage = Command.Usage({
    category: 'Docker',
    description: 'Build the project (currently an alias for `docker build` when an image name is configured)',
    details: `
      If \`imageName\` is configured, runs \`jolt docker build\`. Otherwise prints the \`docker build\` usage and exits 1.
    `,
    examples: [
      ['Build the production image', '$0 build'],
      ['Build the development image', '$0 build --dev'],
    ],
  })

  dev = Option.Boolean('--dev', false, { description: 'Use development configuration for building' })

  async command(): Promise<number | undefined> {
    const {
      config,
      context,
      context: { stdout, stderr },
      dev,
    } = this

    const imageName = await config.get('imageName')

    if (imageName) {
      stdout.write(
        ansis.yellow(`Found a configured image name (${imageName}) - assuming you wanted to build Docker.\n\n`),
      )

      const args = dev ? ['--dev', 'docker', 'build'] : ['docker', 'build']
      return await this.cli.run(args, context)
    }

    stderr.write(this.cli.usage(DockerBuildCommand))
    return 1
  }
}
