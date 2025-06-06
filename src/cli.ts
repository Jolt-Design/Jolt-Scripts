import { Cli } from 'clipanion'
import { CodeBuildStartCommand, ECSDeployCommand, LogsTailCommand, S3SyncCommand } from './Command/AWS.js'
import { BuildCommand } from './Command/Build.js'
import { CacheFlushCommand } from './Command/Cache.js'
import { ConfigCommand } from './Command/Config.js'
import { DBDumpCommand, DBResetCommand } from './Command/DB.js'
import { DockerBuildCommand, DockerLoginCommand, DockerPushCommand, DockerTagCommand } from './Command/Docker.js'
import { NexcessDeployCommand, NexcessDeployLocalCommand } from './Command/Nexcess.js'
import { RsyncCommand, SSHCommand } from './Command/SSH.js'
import { WPCommand } from './Command/WP.js'
import { CmdCommand } from './Command/Cmd.js'

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
cli.register(S3SyncCommand)
cli.register(LogsTailCommand)
cli.register(CodeBuildStartCommand)
cli.register(NexcessDeployCommand)
cli.register(NexcessDeployLocalCommand)
cli.register(SSHCommand)
cli.register(RsyncCommand)
cli.register(CmdCommand)
cli.runExit(args)
