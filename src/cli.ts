import { Cli } from 'clipanion'
import { BuildCommand } from './Build.js'
import { ConfigCommand } from './Config.js'
import { DockerBuildCommand, DockerLoginCommand, DockerTagCommand } from './Docker.js'
import { WPCommand } from './WP.js'

const [node, app, ...args] = process.argv

const cli = new Cli({
  binaryLabel: 'Jolt Scripts',
  binaryName: 'jolt',
  binaryVersion: '1.0.0',
})

cli.register(BuildCommand)
cli.register(ConfigCommand)
cli.register(DockerBuildCommand)
cli.register(DockerLoginCommand)
cli.register(DockerTagCommand)
cli.register(WPCommand)
cli.runExit(args)
