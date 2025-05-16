import chalk from 'chalk'
import { Command } from 'clipanion'
import getConfig from './Config.js'
import { execa, ExecaError } from 'execa'

export class ECRLoginCommand extends Command {
  static paths = [['login'], ['ecr', 'login']]

  async execute(): Promise<number | undefined> {
    const config = await getConfig()
    const {
      context: { stdout, stderr },
    } = this

    // TODO get URL from ecr_repo_url, get region from repo URL
    const ecrBaseUrl = config.get('ecrBaseUrl') ?? (await config.tfVar('ecr_base_url'))
    const region = config.get('awsRegion') ?? (await config.tfVar('region')) ?? config.awsRegion()

    stdout.write(chalk.blue(`Logging in to ECR repository ${ecrBaseUrl} on ${region}...\n`))

    try {
      const result = await execa(config.command('aws'), ['ecr', 'get-login-password', '--region', region]).pipe(
        config.command('docker'),
        ['login', '--username', 'AWS', '--password-stdin', ecrBaseUrl],
        { stdout, stderr },
      )

      return result.exitCode
    } catch (e) {
      if (e instanceof ExecaError) {
        stderr.write(chalk.red(`Failed to log in! Reason: ${e.message}\n`))
        return e.exitCode
      }

      throw e
    }
  }
}
