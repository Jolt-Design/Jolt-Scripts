import ansis from 'ansis'
import { Option } from 'clipanion'
import { execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'

export class SSHCommand extends JoltCommand {
  static paths = [['ssh']]
  requiredCommands = ['ssh']

  dev = Option.Boolean('--dev', false, { description: 'Connect to development environment' })
  args = Option.Proxy()

  getRequiredConfig(): string[] {
    return this.dev ? ['devSshAccount'] : ['sshAccount']
  }

  async command(): Promise<number | undefined> {
    const { args, config, context, dev } = this

    const sshCommand = await config.command('ssh')
    const sshAccount = dev ? await config.get('devSshAccount') : await config.get('sshAccount')

    // sshAccount is guaranteed to exist due to getRequiredConfig() validation
    const parsedArgs = await Promise.all(args.map((x) => config.parseArg(x)))
    const result = await execC(sshCommand, [sshAccount as string, ...parsedArgs], { context })
    return result.exitCode
  }
}

export class RsyncCommand extends JoltCommand {
  static paths = [['rsync']]
  requiredCommands = ['rsync', 'ssh']

  dev = Option.Boolean('--dev', false, { description: 'Sync to development environment' })
  dryRun = Option.Boolean('--dry-run', false, { description: 'Show what would be synced without actually syncing' })
  args = Option.Proxy()

  getRequiredConfig(): string[] {
    return this.dev ? ['devSshAccount'] : ['sshAccount']
  }

  async command(): Promise<number | undefined> {
    const {
      args,
      config,
      context,
      context: { stdout },
      dev,
      dryRun,
    } = this

    const [sshCommand, rsyncCommand, sshPort, sshAccount, contentFolder] = await Promise.all([
      config.command('ssh'),
      config.command('rsync'),
      config.get('sshPort').then((port) => port || '22'),
      dev ? config.get('devSshAccount') : config.get('sshAccount'),
      dev ? config.get('devFolder') : config.get('liveFolder'),
    ])
    const dryRunArg = dryRun ? '--dry-run' : ''

    // sshAccount is guaranteed to exist due to getRequiredConfig() validation
    const params = {
      acc: sshAccount as string,
      contentFolder: contentFolder ?? '',
    }

    const parsedArgs = await Promise.all(args.map((x) => config.parseArg(x, params)))
    const fullArgs = [`--rsh="${sshCommand} -p${sshPort}"`, '-av', dryRunArg, ...parsedArgs]
    stdout.write(ansis.blue(`Running command: ${rsyncCommand} ${fullArgs.join(' ')}...\n`))
    const result = await execC(rsyncCommand, fullArgs, { context })

    return result.exitCode
  }
}
