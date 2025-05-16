import { Cli } from 'clipanion'
import { BuildCommand, BuildDockerCommand } from './Build.js'
import { ECRLoginCommand } from './ECR.js'

const [node, app, ...args] = process.argv

const cli = new Cli({
  binaryLabel: 'Jolt Scripts',
  binaryName: 'jolt',
  binaryVersion: '1.0.0',
})

cli.register(BuildCommand)
cli.register(BuildDockerCommand)
cli.register(ECRLoginCommand)
cli.runExit(args)
