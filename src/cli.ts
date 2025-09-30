#!/usr/bin/env node

import { Cli } from 'clipanion'
import {
  CloudFrontInvalidateCommand,
  CodeBuildStartCommand,
  ECSDeployCommand,
  ECSDeploySpecificCommand,
  ECSStatusCommand,
  LogsTailCommand,
  S3SyncCommand,
} from './Command/AWS.js'
import { BuildCommand } from './Command/Build.js'
import { CacheFlushCommand } from './Command/Cache.js'
import { CmdCommand } from './Command/Cmd.js'
import { ConfigCommand, ConfigInitCommand } from './Command/Config.js'
import { DBAwaitCommand, DBDumpCommand, DBResetCommand } from './Command/DB.js'
import {
  DockerBuildCommand,
  DockerCombinedCommand,
  DockerLoginCommand,
  DockerManifestCommand,
  DockerPushCommand,
  DockerTagCommand,
} from './Command/Docker.js'
import { NexcessDeployCommand, NexcessDeployLocalCommand, NexcessDeploySpecificCommand } from './Command/Nexcess.js'
import { PrepareCommand } from './Command/Prepare.js'
import { RsyncCommand, SSHCommand } from './Command/SSH.js'
import { WPCLICommand, WPCommand } from './Command/WP.js'
import { getPackageJson } from './utils.js'

const [_node, _app, ...args] = process.argv
const packageInfo = await getPackageJson()

const cli = new Cli({
  binaryLabel: 'Jolt Scripts',
  binaryName: Object.keys(packageInfo.bin)[0],
  binaryVersion: packageInfo.version,
})

cli.register(BuildCommand)
cli.register(ConfigCommand)
cli.register(ConfigInitCommand)
cli.register(DockerBuildCommand)
cli.register(DockerLoginCommand)
cli.register(DockerTagCommand)
cli.register(DockerPushCommand)
cli.register(DockerCombinedCommand)
cli.register(DockerManifestCommand)
cli.register(WPCommand)
cli.register(WPCLICommand)
cli.register(ECSDeployCommand)
cli.register(ECSDeploySpecificCommand)
cli.register(ECSStatusCommand)
cli.register(DBDumpCommand)
cli.register(DBResetCommand)
cli.register(DBAwaitCommand)
cli.register(CacheFlushCommand)
cli.register(S3SyncCommand)
cli.register(LogsTailCommand)
cli.register(CodeBuildStartCommand)
cli.register(NexcessDeployCommand)
cli.register(NexcessDeploySpecificCommand)
cli.register(NexcessDeployLocalCommand)
cli.register(SSHCommand)
cli.register(RsyncCommand)
cli.register(CmdCommand)
cli.register(CloudFrontInvalidateCommand)
cli.register(PrepareCommand)
cli.runExit(args)
