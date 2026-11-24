import { spawn } from 'node:child_process'
import ansis from 'ansis'
import { type BaseContext, Command, Option } from 'clipanion'
import * as t from 'typanion'
import { AWSConsoleUrlGenerator } from '../AWSConsoleUrlGenerator.js'
import { delay, execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'

abstract class AWSCommand extends JoltCommand {
  requiredCommands = ['aws']
  region = Option.String('--region', { required: false, description: 'AWS region to use for operations' })

  /**
   * Get the AWS region to use for operations
   */
  protected async getRegion(): Promise<string> {
    const { config, region } = this

    if (region) {
      return await config.parseArg(region)
    }

    const configRegion = await config.get('awsRegion')
    return configRegion || 'eu-west-1'
  }

  protected async getRegionArg() {
    const region = await this.getRegion()
    return region ? `--region=${region}` : ''
  }

  /**
   * Monitor a CodeBuild build until it completes
   * @param buildId The build ID to monitor
   * @returns The final build status
   */
  protected async waitForBuildCompletion(buildId: string): Promise<string> {
    const { config } = this
    const regionArg = await this.getRegionArg()

    // Terminal states that indicate build completion
    const terminalStates = ['SUCCEEDED', 'FAILED', 'FAULT', 'STOPPED', 'TIMED_OUT']

    while (true) {
      const result = await execC(
        await config.command('aws'),
        [regionArg, 'codebuild', 'batch-get-builds', `--ids=${buildId}`],
        {
          env: { AWS_PAGER: '' },
        },
      )

      if (result.stdout) {
        const output = JSON.parse(result.stdout.toString())
        const build = output.builds?.[0]

        if (build?.buildStatus && terminalStates.includes(build.buildStatus)) {
          return build.buildStatus
        }
      }

      // Wait 5 seconds before checking again
      await delay(5000)
    }
  }
}

export class ECSDeployCommand extends AWSCommand {
  static paths = [['aws', 'ecs', 'deploy']]

  static usage = Command.Usage({
    category: 'AWS',
    description: 'Start a new deployment of the ECS service',
    details: `
      Runs \`ecs update-service --force-new-deployment\` (disable with \`--no-force-new-deployment\`), which makes ECS
      pull the current image for its tag. The cluster and service come from \`ecsCluster\` and \`ecsService\`
      (\`devEcsCluster\` and \`devEcsService\` with \`--dev\`), falling back to the Terraform outputs \`ecs_cluster\`
      and \`ecs_service\` (\`dev_\` prefixed with \`--dev\`). Prints AWS Console links.

      Requires aws. Exits 1 if no cluster or service is found. The region comes from \`--region\`, then
      \`awsRegion\`, then eu-west-1.
    `,
    examples: [
      ['Deploy production', '$0 aws ecs deploy'],
      ['Deploy the dev service in another region', '$0 aws ecs deploy --dev --region us-east-1'],
    ],
  })

  dev = Option.Boolean('--dev', false, { description: 'Deploy to development environment' })
  forceNew = Option.Boolean('--force-new-deployment', true, {
    description: 'Force a new deployment even if no changes are detected',
  })

  async command(): Promise<number | undefined> {
    const {
      config,
      dev,
      context: { stdout, stderr },
    } = this

    const awsCommand = await config.command('aws')

    let cluster = await config.get(dev ? 'devEcsCluster' : 'ecsCluster')

    if (!cluster) {
      cluster = await config.tfVar(dev ? 'dev_ecs_cluster' : 'ecs_cluster')
    }

    let service = await config.get(dev ? 'devEcsService' : 'ecsService')

    if (!service) {
      service = await config.tfVar(dev ? 'dev_ecs_service' : 'ecs_service')
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
      const region = await this.getRegion()

      stdout.write(ansis.blue.bold('⛅ Started deploy:\n'))
      stdout.write(`${ansis.white('Cluster ARN:')} ${service.clusterArn}\n`)
      stdout.write(`${ansis.white('Service Name:')} ${service.serviceName}\n`)
      stdout.write(`${ansis.white('Service ARN:')} ${service.serviceArn}\n`)

      // Add console URLs
      stdout.write(`\n${ansis.blue.bold('🔗 AWS Console Links:')}\n`)
      stdout.write(
        `${ansis.white('ECS Service:')} ${AWSConsoleUrlGenerator.ecsService(region, cluster, service.serviceName)}\n`,
      )
      stdout.write(`${ansis.white('ECS Cluster:')} ${AWSConsoleUrlGenerator.ecsCluster(region, cluster)}\n`)

      return 0
    }

    stderr.write(ansis.red('Failed to deploy!\n'))

    return result.exitCode
  }
}

export class S3SyncCommand extends AWSCommand {
  static paths = [['aws', 's3', 'sync']]

  static usage = Command.Usage({
    category: 'AWS',
    description: 'Run `aws s3 sync` between two locations, with placeholders resolved',
    details: `
      Both arguments can be local paths or S3 URLs and can contain placeholders such as \`{tf:bucket_name}\`.
      \`--delete\` removes files from the destination that aren't in the source, which is permanent unless the
      bucket is versioned.

      Requires aws.
    `,
    examples: [['Upload a folder to a bucket', '$0 aws s3 sync ./dist s3://{tf:bucket_name}/assets']],
  })

  deleteOpt = Option.Boolean('--delete', { description: 'Delete files in destination that do not exist in source' })
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

    // Add console URLs for S3 buckets
    const region = await this.getRegion()
    const fromBucket = AWSConsoleUrlGenerator.extractS3Bucket(parsedFrom)
    const toBucket = AWSConsoleUrlGenerator.extractS3Bucket(parsedTo)

    if (fromBucket || toBucket) {
      stdout.write(`\n${ansis.blue.bold('🔗 AWS Console Links:')}\n`)
      if (fromBucket) {
        stdout.write(`${ansis.white('Source Bucket:')} ${AWSConsoleUrlGenerator.s3Bucket(region, fromBucket)}\n`)
      }
      if (toBucket) {
        stdout.write(`${ansis.white('Target Bucket:')} ${AWSConsoleUrlGenerator.s3Bucket(region, toBucket)}\n`)
      }
    }

    return result.exitCode
  }
}

export class LogsTailCommand extends AWSCommand {
  static paths = [['aws', 'logs', 'tail']]

  static usage = Command.Usage({
    category: 'AWS',
    description: 'Follow a CloudWatch log group with `aws logs tail --follow`',
    details: `
      The first argument is the log group, with placeholders resolved. Any further arguments go to
      \`aws logs tail\`. \`--clean\` hides health-check, heartbeat and similar repetitive lines. It runs until
      interrupted.

      Requires aws.
    `,
    examples: [
      ['Follow a log group', '$0 aws logs tail {tf:log_group}'],
      ['Follow with noise filtered out, last 10 minutes first', '$0 aws logs tail --clean /ecs/site --since 10m'],
    ],
  })

  group = Option.String()
  clean = Option.Boolean('--clean', false, { description: 'Filter out repetitive log entries' })
  args = Option.Proxy()
  passThroughOptions = ['--region']

  getProxyArgs(): string[] {
    return this.args
  }

  async command(): Promise<number | undefined> {
    const { config, context, clean } = this
    const group = await config.parseArg(this.group)

    await this.displayHeader(group, clean)

    const command = await config.command('aws')
    const awsArgs = await this.buildAwsArgs(group)

    if (clean) {
      return this.runWithFiltering(command, awsArgs, context)
    }

    return this.runWithoutFiltering(command, awsArgs, context)
  }

  private async displayHeader(group: string, clean: boolean): Promise<void> {
    const { stdout } = this.context
    const region = await this.getRegion()

    stdout.write(ansis.blue(`⛅ Tailing logs from ${group}${clean ? ' (filtered)' : ''}...\n`))
    stdout.write(`${ansis.blue.bold('🔗 AWS Console Link:')}\n`)
    stdout.write(`${ansis.white('CloudWatch Logs:')} ${AWSConsoleUrlGenerator.cloudWatchLogGroup(region, group)}\n\n`)
  }

  private async buildAwsArgs(group: string): Promise<string[]> {
    return [await this.getRegionArg(), 'logs', 'tail', group, '--follow', ...this.args]
  }

  private getSpamPatterns(): RegExp[] {
    return [
      /GET \/health(\?|$)/,
      /GET \/status(\?|$)/,
      /GET \/ping(\?|$)/,
      /GET \/favicon\.ico/,
      /GET \/robots\.txt/,
      /wp-json\/wp\/v2\/types/,
      /admin-ajax\.php.*heartbeat/,
      /health check/i,
      /keepalive/i,
      /ELB-HealthChecker/,
      /Amazon-Route53-Health-Check-Service/,
    ]
  }

  private createAnsiRegex(): RegExp {
    return new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
  }

  private shouldFilterLine(line: string, patterns: RegExp[]): boolean {
    const cleanLine = line.replace(this.createAnsiRegex(), '')
    return patterns.some((pattern) => pattern.test(cleanLine))
  }

  private runWithFiltering(command: string, awsArgs: string[], context: BaseContext): Promise<number> {
    const patterns = this.getSpamPatterns()
    const colorizedArgs = ['--color', 'on', ...awsArgs.filter((arg) => arg !== null)]

    return new Promise<number>((resolve) => {
      const proc = spawn(command, colorizedArgs, {
        stdio: ['inherit', 'pipe', 'inherit'],
        env: {
          ...process.env,
          AWS_PAGER: '',
          FORCE_COLOR: '1',
          CLICOLOR_FORCE: '1',
          AWS_CLI_AUTO_PROMPT: 'on-partial',
          TERM: process.env.TERM || 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      })

      let buffer = ''

      proc.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) {
            context.stdout.write('\n')
            continue
          }

          if (!this.shouldFilterLine(line, patterns)) {
            context.stdout.write(`${line}\n`)
          }
        }
      })

      proc.on('close', (code: number | null) => {
        if (buffer.trim() && !this.shouldFilterLine(buffer, patterns)) {
          context.stdout.write(buffer)
        }
        resolve(code || 0)
      })

      proc.on('error', (error: Error) => {
        context.stderr?.write(`Error: ${error.message}\n`)
        resolve(1)
      })
    })
  }

  private async runWithoutFiltering(
    command: string,
    awsArgs: string[],
    context: BaseContext,
  ): Promise<number | undefined> {
    const result = await execC(command, awsArgs, { context, reject: false })
    return result.exitCode
  }
}

export class CodeBuildStartCommand extends AWSCommand {
  static paths = [['aws', 'codebuild', 'start']]

  static usage = Command.Usage({
    category: 'AWS',
    description: 'Start a CodeBuild build',
    details: `
      The project is the argument if given, otherwise \`codebuildProject\` (\`devCodebuildProject\` with \`--dev\`),
      otherwise the Terraform output \`codebuild_project_name\` (\`dev_\` prefixed with \`--dev\`). \`--batch\` starts a
      batch build. Prints the build ID and AWS Console links.

      Requires aws. Exits 1 if no project is found.
    `,
    examples: [
      ['Start the configured project', '$0 aws codebuild start'],
      ['Start a named project as a batch build', '$0 aws codebuild start --batch my-project'],
    ],
  })

  dev = Option.Boolean('--dev', false, { description: 'Use development CodeBuild project' })
  batch = Option.Boolean('--batch', false, { description: 'Start a batch build instead of a regular build' })
  project = Option.String({ required: false })

  async command(): Promise<number | undefined> {
    const {
      batch,
      config,
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

    const result = await execC(
      await config.command('aws'),
      [regionArg, 'codebuild', batch ? 'start-build-batch' : 'start-build', `--project-name=${target}`],
      {
        env: { AWS_PAGER: '' },
      },
    )

    if (result.stdout === undefined) {
      stderr.write(ansis.red('⛅ Missing output for codebuild start command'))
      return 5
    }

    const output = JSON.parse(result.stdout.toString())
    const { build } = output
    const region = await this.getRegion()

    stdout.write(ansis.blue.bold('⛅ Started project build:\n'))
    stdout.write(`${ansis.white('ID:')} ${build.id}\n`)
    stdout.write(`${ansis.white('Project:')} ${build.projectName}\n`)
    stdout.write(`${ansis.white('Build Number:')} ${build.buildNumber}\n`)

    // Add console URLs
    stdout.write(`\n${ansis.blue.bold('🔗 AWS Console Links:')}\n`)
    stdout.write(`${ansis.white('CodeBuild Project:')} ${AWSConsoleUrlGenerator.codeBuildProject(region, target)}\n`)
    stdout.write(`${ansis.white('This Build:')} ${AWSConsoleUrlGenerator.codeBuildBuild(region, target, build.id)}\n\n`)

    stdout.write(
      ansis.blue.bold(
        '⛅ Tailing build logs (automatically stops when build completes). Nothing will show until source download completes...\n',
      ),
    )

    const abortController = new AbortController()
    let logTailPromise: ReturnType<typeof execC> | null = null

    // Set up signal handlers to abort the controller when user presses Ctrl-C
    const signalHandler = () => {
      abortController.abort()
    }

    process.on('SIGINT', signalHandler)
    process.on('SIGTERM', signalHandler)

    try {
      const buildStatusPromise = this.waitForBuildCompletion(build.id)

      try {
        logTailPromise = execC(
          await config.command('aws'),
          ['logs', 'tail', regionArg, `/aws/codebuild/${target}`, '--follow', '--since=0s'].filter((x) => !!x),
          {
            context: this.context,
            env: { ...process.env, AWS_PAGER: '' },
            cancelSignal: abortController.signal,
          },
        )
      } catch (_logError) {
        stdout.write(ansis.yellow('⛅ Log tailing unavailable (logs may not be ready yet)\n'))
      }

      const finalStatus = await buildStatusPromise

      abortController.abort()

      stdout.write(`\n${ansis.blue.bold('⛅ Build completed with status:')} ${ansis.white(finalStatus)}\n`)

      return finalStatus === 'SUCCEEDED' ? 0 : 1
    } catch (error) {
      stderr.write(ansis.red(`⛅ Error during build monitoring: ${(error as Error).message}\n`))
      return 1
    } finally {
      // Clean up signal handlers
      process.off('SIGINT', signalHandler)
      process.off('SIGTERM', signalHandler)

      abortController.abort()

      if (logTailPromise) {
        try {
          await Promise.race([
            logTailPromise,
            delay(1000), // 1 second timeout
          ])
        } catch {
          // Ignore errors from cancelled log tailing process
        }
      }
    }
  }
}

export class CloudFrontInvalidateCommand extends AWSCommand {
  static paths = [['aws', 'cf', 'invalidate']]

  static usage = Command.Usage({
    category: 'AWS',
    description: 'Create a CloudFront cache invalidation',
    details: `
      Invalidates \`/*\` unless \`--path\` is given (repeatable). \`--invalidation-batch\` passes a batch ID to the AWS
      CLI instead of paths, and can't be combined with \`--path\`. The distribution ID is required and can contain
      placeholders.

      Requires aws.
    `,
    examples: [
      ['Invalidate everything', '$0 aws cf invalidate {tf:cloudfront_distribution}'],
      ['Invalidate specific paths', '$0 aws cf invalidate E123ABC --path "/css/*" --path "/index.html"'],
    ],
  })

  distribution = Option.String({ required: true })
  invalidationPaths = Option.Array('--path', { required: false, description: 'Specific paths to invalidate' })
  invalidationBatch = Option.String('--invalidation-batch', {
    required: false,
    description: 'Invalidation batch ID to check status',
  })

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
      const region = await this.getRegion()

      stdout.write(ansis.blue.bold('⛅ Started cache invalidation:\n'))
      stdout.write(`${ansis.white('Invalidation ID:')} ${invalidation.Id}\n`)

      // Add console URL
      stdout.write(`\n${ansis.blue.bold('🔗 AWS Console Link:')}\n`)
      stdout.write(
        `${ansis.white('CloudFront Distribution:')} ${AWSConsoleUrlGenerator.cloudFrontDistribution(region, target)}\n`,
      )

      return 0
    }

    stderr.write(ansis.red('⛅ Failed to invalidate!\n'))

    return result.exitCode
  }
}

type ECSStatusDeployment = {
  status: string
  taskDefinition: string
  runningCount: number
  pendingCount: number
  desiredCount: number
}

type ECSStatusTask = {
  id: string
  arn: string
  status: string
  cpu: string
  memory: string
  createdAt?: string
}

type ECSStatus = {
  region: string
  environment: 'dev' | 'prod'
  configured: boolean
  cluster: {
    name: string
    consoleUrl: string
    status?: string
    activeServicesCount?: number
    runningTasksCount?: number
    pendingTasksCount?: number
    registeredContainerInstancesCount?: number
  } | null
  service: {
    name: string
    consoleUrl?: string
    status?: string
    runningCount?: number
    pendingCount?: number
    desiredCount?: number
    taskDefinition?: string
    deployments: ECSStatusDeployment[]
    tasks: ECSStatusTask[]
  } | null
}

export class ECSStatusCommand extends AWSCommand {
  static paths = [['aws', 'status']]

  static usage = Command.Usage({
    category: 'AWS',
    description: 'Show the status of the ECS cluster and service',
    details: `
      Read-only. Looks up the cluster and service the same way as \`aws ecs deploy\`, then prints their state and AWS
      Console links. If no ECS config is found it says so and exits 0.

      \`--format json\` prints a single JSON object to stdout instead, with \`region\`, \`environment\`, \`configured\`,
      \`cluster\` and \`service\`. Each of \`cluster\` and \`service\` is null when it isn't configured. Warnings still go
      to stderr.

      Requires aws.
    `,
    examples: [
      ['Check production', '$0 aws status'],
      ['Check dev', '$0 aws status --dev'],
      ['Get the status as JSON', '$0 aws status --format json'],
    ],
  })

  dev = Option.Boolean('--dev', false, { description: 'Check development environment status' })

  format = Option.String('--format', 'pretty', {
    validator: t.isEnum(['pretty', 'json']),
    description: 'Output format: "pretty" for people or "json" for scripts and agents',
  })

  async command(): Promise<number | undefined> {
    const {
      config,
      dev,
      context: { stdout },
      format,
    } = this

    const awsCommand = await config.command('aws')
    const regionArg = await this.getRegionArg()

    // Try to get ECS configuration
    let cluster = await config.get(dev ? 'devEcsCluster' : 'ecsCluster')
    if (!cluster) {
      cluster = await config.tfVar(dev ? 'dev_ecs_cluster' : 'ecs_cluster')
    }

    let service = await config.get(dev ? 'devEcsService' : 'ecsService')
    if (!service) {
      service = await config.tfVar(dev ? 'dev_ecs_service' : 'ecs_service')
    }

    const region = await this.getRegion()
    const environment = dev ? 'dev' : 'prod'

    // Check if ECS is configured
    if (!cluster && !service) {
      if (format === 'json') {
        const status: ECSStatus = { region, environment, configured: false, cluster: null, service: null }
        stdout.write(`${JSON.stringify(status, null, 2)}\n`)
        return 0
      }

      stdout.write(ansis.yellow('⛅ No ECS configuration detected\n'))
      stdout.write(ansis.dim('   Configure ecsCluster/ecsService or use Terraform variables\n'))
      return 0
    }

    const status = await this.collectStatus({ awsCommand, regionArg, region, environment, cluster, service })

    if (format === 'json') {
      stdout.write(`${JSON.stringify(status, null, 2)}\n`)
    } else {
      this.printStatus(status)
    }

    return 0
  }

  private async collectStatus(options: {
    awsCommand: string
    regionArg: string
    region: string
    environment: 'dev' | 'prod'
    cluster: string | undefined
    service: string | undefined
  }): Promise<ECSStatus> {
    const { awsCommand, regionArg, region, environment, cluster, service } = options
    const { stderr } = this.context
    const awsOptions = { env: { AWS_PAGER: '' }, extendEnv: true }

    const status: ECSStatus = {
      region,
      environment,
      configured: true,
      cluster: cluster ? { name: cluster, consoleUrl: AWSConsoleUrlGenerator.ecsCluster(region, cluster) } : null,
      service: service
        ? {
            name: service,
            consoleUrl: cluster ? AWSConsoleUrlGenerator.ecsService(region, cluster, service) : undefined,
            deployments: [],
            tasks: [],
          }
        : null,
    }

    if (cluster && status.cluster) {
      try {
        const clusterResult = await execC(
          awsCommand,
          [regionArg, 'ecs', 'describe-clusters', '--clusters', cluster, '--include', 'STATISTICS'],
          awsOptions,
        )

        if (clusterResult.exitCode === 0 && clusterResult.stdout) {
          const clusterInfo = JSON.parse(clusterResult.stdout.toString()).clusters?.[0]

          if (clusterInfo) {
            status.cluster.status = clusterInfo.status
            status.cluster.activeServicesCount = clusterInfo.activeServicesCount
            status.cluster.runningTasksCount = clusterInfo.runningTasksCount
            status.cluster.pendingTasksCount = clusterInfo.pendingTasksCount
            status.cluster.registeredContainerInstancesCount = clusterInfo.registeredContainerInstancesCount
          }
        }
      } catch (error) {
        stderr.write(ansis.yellow(`⛅ Warning: Could not retrieve cluster information: ${error}\n`))
      }
    }

    if (cluster && service && status.service) {
      try {
        const serviceResult = await execC(
          awsCommand,
          [regionArg, 'ecs', 'describe-services', '--cluster', cluster, '--services', service],
          awsOptions,
        )

        if (serviceResult.exitCode === 0 && serviceResult.stdout) {
          const serviceInfo = JSON.parse(serviceResult.stdout.toString()).services?.[0]

          if (serviceInfo) {
            status.service.status = serviceInfo.status
            status.service.runningCount = serviceInfo.runningCount
            status.service.pendingCount = serviceInfo.pendingCount
            status.service.desiredCount = serviceInfo.desiredCount
            status.service.taskDefinition = serviceInfo.taskDefinition
            status.service.deployments = (serviceInfo.deployments ?? []).map((deployment: ECSStatusDeployment) => ({
              status: deployment.status,
              taskDefinition: deployment.taskDefinition,
              runningCount: deployment.runningCount,
              pendingCount: deployment.pendingCount,
              desiredCount: deployment.desiredCount,
            }))

            status.service.tasks = await this.collectTasks(awsCommand, regionArg, cluster, service)
          }
        }
      } catch (error) {
        stderr.write(ansis.yellow(`⛅ Warning: Could not retrieve service information: ${error}\n`))
      }
    }

    return status
  }

  private async collectTasks(
    awsCommand: string,
    regionArg: string,
    cluster: string,
    service: string,
  ): Promise<ECSStatusTask[]> {
    const awsOptions = { env: { AWS_PAGER: '' }, extendEnv: true }

    const tasksResult = await execC(
      awsCommand,
      [regionArg, 'ecs', 'list-tasks', '--cluster', cluster, '--service-name', service],
      awsOptions,
    )

    if (tasksResult.exitCode !== 0 || !tasksResult.stdout) {
      return []
    }

    const { taskArns } = JSON.parse(tasksResult.stdout.toString())

    if (!taskArns?.length) {
      return []
    }

    const taskDetailsResult = await execC(
      awsCommand,
      [regionArg, 'ecs', 'describe-tasks', '--cluster', cluster, '--tasks', ...taskArns],
      awsOptions,
    )

    if (taskDetailsResult.exitCode !== 0 || !taskDetailsResult.stdout) {
      return []
    }

    const taskDetails = JSON.parse(taskDetailsResult.stdout.toString())

    return (taskDetails.tasks ?? []).map(
      (task: { taskArn: string; lastStatus: string; cpu: string; memory: string; createdAt?: string }) => ({
        id: task.taskArn.split('/').pop() ?? task.taskArn,
        arn: task.taskArn,
        status: task.lastStatus,
        cpu: task.cpu,
        memory: task.memory,
        createdAt: task.createdAt,
      }),
    )
  }

  private printStatus(status: ECSStatus): void {
    const { stdout } = this.context
    const { cluster, service } = status

    stdout.write(ansis.blue.bold('⛅ AWS ECS Status\n'))
    stdout.write(ansis.blue(`${'─'.repeat(50)}\n`))

    stdout.write(`${ansis.blue.bold('🔗 AWS Console Links:')}\n`)

    if (cluster) {
      stdout.write(`${ansis.white('ECS Cluster:')} ${cluster.consoleUrl}\n`)
    }

    if (cluster && service) {
      stdout.write(`${ansis.white('ECS Service:')} ${service.consoleUrl}\n`)
    }

    stdout.write('\n')

    if (cluster) {
      stdout.write(`${ansis.white('Cluster:')} ${cluster.name}\n`)

      if (cluster.status !== undefined) {
        stdout.write(`${ansis.white('Status:')} ${cluster.status}\n`)
        stdout.write(`${ansis.white('Active Services:')} ${cluster.activeServicesCount}\n`)
        stdout.write(`${ansis.white('Running Tasks:')} ${cluster.runningTasksCount}\n`)
        stdout.write(`${ansis.white('Pending Tasks:')} ${cluster.pendingTasksCount}\n`)
        stdout.write(`${ansis.white('Registered Container Instances:')} ${cluster.registeredContainerInstancesCount}\n`)
      }
    }

    if (!service) {
      return
    }

    stdout.write(`\n${ansis.white('Service:')} ${service.name}\n`)

    if (!cluster) {
      stdout.write(ansis.yellow('   Service configured but no cluster found\n'))
      return
    }

    if (service.status === undefined) {
      return
    }

    stdout.write(`${ansis.white('Status:')} ${service.status}\n`)
    stdout.write(`${ansis.white('Running Count:')} ${service.runningCount}\n`)
    stdout.write(`${ansis.white('Pending Count:')} ${service.pendingCount}\n`)
    stdout.write(`${ansis.white('Desired Count:')} ${service.desiredCount}\n`)
    stdout.write(`${ansis.white('Task Definition:')} ${service.taskDefinition}\n`)

    if (service.deployments.length > 0) {
      stdout.write(`\n${ansis.white.bold('Deployments:')}\n`)

      service.deployments.forEach((deployment, index) => {
        const deploymentStatus =
          deployment.status === 'PRIMARY' ? ansis.green(deployment.status) : ansis.yellow(deployment.status)
        stdout.write(`  ${index + 1}. ${deploymentStatus} - ${deployment.taskDefinition}\n`)
        stdout.write(
          `     Running: ${deployment.runningCount}, Pending: ${deployment.pendingCount}, Desired: ${deployment.desiredCount}\n`,
        )
      })
    }

    if (service.tasks.length > 0) {
      stdout.write(`\n${ansis.white.bold('Active Tasks:')}\n`)

      service.tasks.forEach((task, index) => {
        const taskStatus = task.status === 'RUNNING' ? ansis.green(task.status) : ansis.yellow(task.status)
        stdout.write(`  ${index + 1}. ${task.id} - ${taskStatus}\n`)
        stdout.write(`     CPU/Memory: ${task.cpu}/${task.memory}\n`)

        if (task.createdAt) {
          stdout.write(`     Created: ${new Date(task.createdAt).toLocaleString()}\n`)
        }
      })
    }
  }
}

export class ECSDeploySpecificCommand extends AWSCommand {
  static paths = [['aws', 'ecs', 'deploy-specific']]

  static usage = Command.Usage({
    category: 'AWS',
    description: 'Deploy a specific image tag to the ECS service',
    details: `
      Registers a new task definition revision with the first container's image changed to the given tag, then
      deploys the service as \`aws ecs deploy\` does, so the cluster and service come from the same config keys and
      Terraform outputs. The task definition family comes from the Terraform output \`ecs_task_definition\`
      (\`dev_ecs_task_definition\` with \`--dev\`). Use it to roll back to an earlier tag, such as a commit SHA created by \`docker push\`.

      Requires aws. Exits 1 if a Terraform output is missing.
    `,
    examples: [['Roll production back to a commit image', '$0 aws ecs deploy-specific 1a2b3c4d']],
  })

  dev = Option.Boolean('--dev', false, { description: 'Deploy to development environment' })
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
    const cluster =
      (await config.get(dev ? 'devEcsCluster' : 'ecsCluster')) ||
      (await config.tfVar(dev ? 'dev_ecs_cluster' : 'ecs_cluster'))
    const service =
      (await config.get(dev ? 'devEcsService' : 'ecsService')) ||
      (await config.tfVar(dev ? 'dev_ecs_service' : 'ecs_service'))
    const family = await config.tfVar(dev ? 'dev_ecs_task_definition' : 'ecs_task_definition')

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

    // Add console URLs before deploying
    const region = await this.getRegion()
    stdout.write(`\n${ansis.blue.bold('🔗 AWS Console Links:')}\n`)
    stdout.write(`${ansis.white('ECS Cluster:')} ${AWSConsoleUrlGenerator.ecsCluster(region, cluster)}\n`)
    stdout.write(`${ansis.white('ECS Service:')} ${AWSConsoleUrlGenerator.ecsService(region, cluster, service)}\n\n`)

    return await cli.run([
      'aws',
      'ecs',
      'deploy',
      ...(dev ? ['--dev'] : []),
      ...(this.region ? ['--region', this.region] : []),
    ])
  }
}
