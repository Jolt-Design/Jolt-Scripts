import { Option } from 'clipanion'
import JoltCommand from './JoltCommand.js'
import chalk from 'chalk'
import shelljs from 'shelljs'
import { execC } from '../utils.js'
const { which } = shelljs

export class ECSDeployCommand extends JoltCommand {
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

    const args = ['ecs', 'update-service', `--cluster='${cluster}'`, `--service='${service}'`, '--force-new-deployment']

    if (!cluster) {
      stderr.write(chalk.red('ECS cluster must be configured!\n'))
      return 1
    }

    if (!service) {
      stderr.write(chalk.red('ECS service must be configured!\n'))
      return 1
    }

    if (!which(awsCommand)) {
      stderr.write(chalk.red(`Could not find command ${awsCommand}!\n`))
      return 2
    }

    stdout.write(chalk.blue(`⛅ Deploying service ${service} on cluster ${cluster}...\n`))

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
      stdout.write(chalk.blue.bold('⛅ Started deploy:\n'))
      stdout.write(`${chalk.white('Cluster ARN:')} ${service.clusterArn}\n`)
      stdout.write(`${chalk.white('Service Name:')} ${service.serviceName}\n`)
      stdout.write(`${chalk.white('Service ARN:')} ${service.serviceArn}\n`)
      return 0
    }

    stderr.write(chalk.red('Failed to deploy!\n'))

    return result.exitCode
  }
}
