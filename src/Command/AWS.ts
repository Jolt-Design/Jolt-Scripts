import ansis from 'ansis'
import { Option } from 'clipanion'
import shelljs from 'shelljs'
import * as t from 'typanion'
import { execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'

const { which } = shelljs

abstract class AWSCommand extends JoltCommand {
  requiredCommands = ['aws']
  region = Option.String('--region', { required: false })

  protected async getRegionArg() {
    const { config, region } = this

    if (region) {
      return `--region=${await config.parseArg(region)}`
    }

    const configRegion = await config.get('awsRegion')
    return configRegion ? `--region=${configRegion}` : ''
  }
}

export class ECSDeployCommand extends AWSCommand {
  static paths = [['aws', 'ecs', 'deploy']]

  dev = Option.Boolean('--dev', false)
  forceNew = Option.Boolean('--force-new-deployment', true)

  async command(): Promise<number | undefined> {
    const {
      config,
      dev,
      context: { stdout, stderr },
    } = this
    const awsCommand = await config.command('aws')

    let cluster = await config.get(dev ? 'devEcsCluster' : 'ecsCluster')

    if (!cluster) {
      cluster = await config.tfVar(dev ? 'ecs_cluster_dev' : 'ecs_cluster')
    }

    let service = await config.get(dev ? 'devEcsService' : 'ecsService')

    if (!service) {
      service = await config.tfVar(dev ? 'ecs_service_dev' : 'ecs_service')
    }

    const args = [
      await this.getRegionArg(),
      'ecs',
      'update-service',
      `--cluster='${cluster}'`,
      `--service='${service}'`,
      this.forceNew ? '--force-new-deployment' : '',
    ]

    if (!cluster) {
      stderr.write(ansis.red('⛅ ECS cluster must be configured!\n'))
      return 1
    }

    if (!service) {
      stderr.write(ansis.red('⛅ ECS service must be configured!\n'))
      return 1
    }

    if (!which(awsCommand)) {
      stderr.write(ansis.red(`⛅ Could not find command ${awsCommand}!\n`))
      return 2
    }

    stdout.write(ansis.blue(`⛅ Deploying service ${service} on cluster ${cluster}...\n`))

    const result = await execC(awsCommand, args, {
      stderr: this.context.stderr,
      env: {
        AWS_PAGER: '',
      },
      extendEnv: true,
    })

    const output = result.stdout?.toString()

    if (!result.exitCode && output) {
      const resultJson = JSON.parse(output)
      const { service } = resultJson
      stdout.write(ansis.blue.bold('⛅ Started deploy:\n'))
      stdout.write(`${ansis.white('Cluster ARN:')} ${service.clusterArn}\n`)
      stdout.write(`${ansis.white('Service Name:')} ${service.serviceName}\n`)
      stdout.write(`${ansis.white('Service ARN:')} ${service.serviceArn}\n`)
      return 0
    }

    stderr.write(ansis.red('Failed to deploy!\n'))

    return result.exitCode
  }
}

export class S3SyncCommand extends AWSCommand {
  static paths = [['aws', 's3', 'sync']]

  deleteOpt = Option.Boolean('--delete')
  from = Option.String()
  to = Option.String()

  async command(): Promise<number | undefined> {
    const {
      config,
      context,
      context: { stdout },
      deleteOpt,
      from,
      to,
    } = this

    const parsedFrom = await config.parseArg(from)
    const parsedTo = await config.parseArg(to)

    stdout.write(ansis.blue(`⛅ Syncing ${parsedFrom} to ${parsedTo}...\n`))
    const result = await execC(
      await config.command('aws'),
      [await this.getRegionArg(), 's3', 'sync', deleteOpt && '--delete', parsedFrom, parsedTo],
      { context },
    )
    stdout.write(ansis.blue('⛅ Syncing complete.\n'))

    return result.exitCode
  }
}

export class LogsTailCommand extends AWSCommand {
  static paths = [['aws', 'logs', 'tail']]

  group = Option.String()
  args = Option.Proxy()

  async command(): Promise<number | undefined> {
    const {
      args,
      config,
      context,
      context: { stdout },
    } = this

    const group = await config.parseArg(this.group)

    stdout.write(ansis.blue(`⛅ Tailing logs from ${group}...\n`))

    const result = await execC(
      await config.command('aws'),
      [await this.getRegionArg(), 'logs', 'tail', group, '--follow', ...args],
      {
        context,
      },
    )

    return result.exitCode
  }
}

export class CodeBuildStartCommand extends AWSCommand {
  static paths = [['aws', 'codebuild', 'start']]

  dev = Option.Boolean('--dev', false)
  batch = Option.Boolean('--batch', false)
  project = Option.String({ required: false })

  async command(): Promise<number | undefined> {
    const {
      batch,
      cli,
      config,
      context,
      context: { stdout, stderr },
      dev,
      project,
    } = this

    let target: string | undefined

    if (project) {
      target = await config.parseArg(project)
    } else {
      target = await await config.get(dev ? 'devCodebuildProject' : 'codebuildProject')
    }

    if (!target) {
      target = await config.tfVar(dev ? 'dev_codebuild_project_name' : 'codebuild_project_name')
    }

    if (!target) {
      stderr.write(ansis.red('⛅ Failed to find a configured CodeBuild project\n'))
      return 1
    }

    stdout.write(ansis.blue(`⛅ Starting the ${target} CodeBuild project...\n`))
    const regionArg = await this.getRegionArg()

    await execC(
      await config.command('aws'),
      [regionArg, 'codebuild', batch ? 'start-build-batch' : 'start-build', `--project-name=${target}`],
      {
        context,
        env: { AWS_PAGER: '' },
      },
    )

    stdout.write(
      ansis.blue.bold(
        '⛅ Tailing build logs, nothing will show until source download completes and the logs will not stop automatically - press Ctrl-C to close when ready...\n',
      ),
    )

    return await cli.run(
      ['aws', 'logs', 'tail', regionArg, `/aws/codebuild/${target}`, '--since=0s'].filter((x) => !!x),
    )
  }
}

export class CloudFrontInvalidateCommand extends AWSCommand {
  static paths = [['aws', 'cf', 'invalidate']]

  distribution = Option.String({ required: true })
  invalidationPaths = Option.Array('--path', { required: false })
  invalidationBatch = Option.String('--invalidation-batch', { required: false })

  static schema = [t.hasMutuallyExclusiveKeys(['invalidationPaths', 'invalidationBatch'], { missingIf: 'falsy' })]

  async command(): Promise<number | undefined> {
    const {
      config,
      context: { stdout, stderr },
      distribution,
      invalidationBatch,
      invalidationPaths,
    } = this

    let target: string | undefined

    if (distribution) {
      target = await config.parseArg(distribution)
    } else {
      target = await await config.get('cloudfrontDistribution')
    }

    if (!target) {
      target = await config.tfVar('cloudfront_distribution')
    }

    if (!target) {
      stderr.write(
        ansis.red(
          '⛅ Failed to find a configured CloudFront distribution. Configure one or specify it as a parameter.\n',
        ),
      )

      return 1
    }

    stdout.write(ansis.blue(`⛅ Invalidating the ${target} CloudFront distribution cache...\n`))
    const regionArg = await this.getRegionArg()
    let additionalArgs = []

    if (invalidationBatch) {
      additionalArgs = ['--invalidation-batch', invalidationBatch]
    } else {
      const paths = invalidationPaths?.length ? invalidationPaths : ["'/*'"]
      const pathArgs = paths.join(' ')
      additionalArgs = ['--path', pathArgs]
    }

    const result = await execC(await config.command('aws'), [
      regionArg,
      'cloudfront',
      'create-invalidation',
      '--distribution',
      target,
      ...additionalArgs,
    ])

    const output = result.stdout?.toString()

    if (!result.exitCode && output) {
      const resultJson = JSON.parse(output)
      const { Invalidation: invalidation } = resultJson
      stdout.write(ansis.blue.bold('⛅ Started cache invalidation:\n'))
      stdout.write(`${ansis.white('Invalidation ID:')} ${invalidation.Id}\n`)
      return 0
    }

    stderr.write(ansis.red('⛅ Failed to invalidate!\n'))

    return result.exitCode
  }
}

export class ECSDeploySpecificCommand extends AWSCommand {
  static paths = [['aws', 'ecs', 'deploy-specific']]

  dev = Option.Boolean('--dev', false)
  tag = Option.String({ required: true })

  async command(): Promise<number | undefined> {
    const {
      cli,
      config,
      dev,
      context: { stdout, stderr },
      tag,
    } = this

    const awsCommand = await config.command('aws')
    const cluster = await config.tfVar(dev ? 'ecs_cluster_dev' : 'ecs_cluster')
    const service = await config.tfVar(dev ? 'ecs_service_dev' : 'ecs_service')
    const family = await config.tfVar(dev ? 'ecs_task_definition_dev' : 'ecs_task_definition')

    if (!tag) {
      stderr.write(ansis.red('⛅ Image tag parameter must be specified\n'))
      return 2
    }

    if (!cluster) {
      stderr.write(ansis.red('⛅ ECS cluster must be configured!\n'))
      return 1
    }

    if (!service) {
      stderr.write(ansis.red('⛅ ECS service must be configured!\n'))
      return 1
    }

    if (!family) {
      stderr.write(ansis.red('⛅ ECS task definition must be configured!\n'))
      return 1
    }

    const regionArg = await this.getRegionArg()

    stdout.write(ansis.blue(`⛅ Updating ${family} to use image tag :${tag}...\n`))

    // TODO: We probably don't need this anymore
    const queryArgs = [
      'containerDefinitions: taskDefinition.containerDefinitions',
      'family: taskDefinition.family',
      'taskRoleArn: taskDefinition.taskRoleArn',
      'executionRoleArn: taskDefinition.executionRoleArn',
      'networkMode: taskDefinition.networkMode',
      'volumes: taskDefinition.volumes',
      'placementConstraints: taskDefinition.placementConstraints',
      'requiresCompatibilities: taskDefinition.requiresCompatibilities',
      'cpu: taskDefinition.cpu',
      'memory: taskDefinition.memory',
    ]

    const describeTaskDefinitionArgs = [
      regionArg,
      'ecs',
      'describe-task-definition',
      '--task-definition',
      family,
      '--query',
      `{ ${queryArgs.join(', ')} }`,
    ]

    const taskDefinitionResult = await execC(awsCommand, describeTaskDefinitionArgs, {
      env: {
        AWS_PAGER: '',
      },
      shell: false,
      extendEnv: true,
    })

    const taskDefinitionOutput = taskDefinitionResult.stdout?.toString()

    if (taskDefinitionResult.exitCode || typeof taskDefinitionOutput !== 'string') {
      stderr.write(ansis.redBright('⛅ Failure reading task definition!\n'))
      return taskDefinitionResult.exitCode
    }

    const taskDefinition = JSON.parse(taskDefinitionOutput)
    const oldImage: string = taskDefinition.containerDefinitions[0].image
    taskDefinition.containerDefinitions[0].image = oldImage.replace(/:.+$/, `:${tag}`)

    await execC(
      awsCommand,
      [
        regionArg,
        'ecs',
        'register-task-definition',
        '--family',
        family,
        '--cli-input-json',
        JSON.stringify(taskDefinition),
      ],
      { shell: false },
    )

    return await cli.run(['aws', 'ecs', 'deploy'])
  }
}
