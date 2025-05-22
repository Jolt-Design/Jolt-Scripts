import { Cli } from 'clipanion'
import { BuildCommand } from './Command/Build.js'
import { ConfigCommand } from './Command/Config.js'
import { DockerBuildCommand, DockerLoginCommand, DockerPushCommand, DockerTagCommand } from './Command/Docker.js'
import { WPCommand } from './Command/WP.js'
import { ECSDeployCommand } from './Command/AWS.js'
import { DBDumpCommand, DBResetCommand } from './Command/DB.js'
import { CacheFlushCommand } from './Command/Cache.js'

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
cli.register(DockerPushCommand)
cli.register(WPCommand)
cli.register(ECSDeployCommand)
cli.register(DBDumpCommand)
cli.register(DBResetCommand)
cli.register(CacheFlushCommand)
cli.runExit(args)
