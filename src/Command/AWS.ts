import ansis from 'ansis'
import { Option } from 'clipanion'
import shelljs from 'shelljs'
import { execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'
const { which } = shelljs

abstract class AWSCommand extends JoltCommand {
  region = Option.String('--region', { required: false })

  protected async getRegionArg() {
    const { config, region } = this

    if (region) {
      return `--region=${await config.parseArg(region)}`
    }

    const configRegion = config.get('awsRegion')
    return configRegion ? `--region=${configRegion}` : ''
  }
}

export class ECSDeployCommand extends AWSCommand {
  static paths = [['aws', 'ecs', 'deploy']]
  requiredCommands = ['aws']

  dev = Option.Boolean('--dev', false)
  prod = !this.dev

  async command(): Promise<number | undefined> {
    const {
      config,
      dev,
      context,
      context: { stdout, stderr },
    } = this
    const awsCommand = config.command('aws')
    const cluster = await config.tfVar(dev ? 'ecs_cluster_dev' : 'ecs_cluster')
    const service = await config.tfVar(dev ? 'ecs_service_dev' : 'ecs_service')

    const args = [
      await this.getRegionArg(),
      'ecs',
      'update-service',
      `--cluster='${cluster}'`,
      `--service='${service}'`,
      '--force-new-deployment',
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
  requiredCommands = ['aws']

  from = Option.String()
  to = Option.String()

  async command(): Promise<number | undefined> {
    const {
      config,
      from,
      to,
      context: { stdout, stderr },
    } = this

    const parsedFrom = await config.parseArg(from)
    const parsedTo = await config.parseArg(to)

    stdout.write(ansis.blue(`⛅ Syncing ${parsedFrom} to ${parsedTo}...\n`))
    const result = await execC(config.command('aws'), [await this.getRegionArg(), 's3', 'sync', parsedFrom, parsedTo])
    stdout.write(ansis.blue('⛅ Syncing complete.\n'))

    return result.exitCode
  }
}

export class LogsTailCommand extends AWSCommand {
  static paths = [['aws', 'logs', 'tail']]
  requiredCommands = ['aws']

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
      config.command('aws'),
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
  requiredCommands = ['aws']

  dev = Option.Boolean('--dev', false)
  project = Option.String({ required: false })

  async command(): Promise<number | undefined> {
    const {
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
      target = config.get(dev ? 'devCodebuildProject' : 'codebuildProject')
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

    const result = await execC(
      config.command('aws'),
      [regionArg, 'codebuild', 'start-build', `--project-name=${target}`],
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

    return await cli.run(['aws', 'logs', 'tail', regionArg, `/aws/codebuild/${target}`, '--since=0s'])
  }
}

export class CloudFrontInvalidateCommand extends AWSCommand {
  static paths = [['aws', 'cf', 'invalidate']]
  requiredCommands = ['aws']

  distribution = Option.String({ required: true })
  invalidationPaths = Option.Array('--path')

  async command(): Promise<number | undefined> {
    const {
      config,
      context: { stdout, stderr },
      distribution,
      invalidationPaths,
    } = this

    let target: string | undefined

    if (distribution) {
      target = await config.parseArg(distribution)
    } else {
      target = config.get('cloudfrontDistribution')
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
    const paths = invalidationPaths?.length ? invalidationPaths : ["'/*'"]
    const pathArgs = paths.join(' ')

    const result = await execC(config.command('aws'), [
      regionArg,
      'cloudfront',
      'create-invalidation',
      '--distribution',
      target,
      '--path',
      pathArgs,
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
