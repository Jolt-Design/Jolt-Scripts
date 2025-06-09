import ansis from 'ansis'
import { Option } from 'clipanion'
import { execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'

export class SSHCommand extends JoltCommand {
  static paths = [['ssh']]
  requiredCommands = ['ssh']

  dev = Option.Boolean('--dev', false)
  args = Option.Proxy()

  async command(): Promise<number | undefined> {
    const {
      args,
      config,
      context,
      context: { stderr },
      dev,
    } = this

    const sshCommand = config.command('ssh')
    const sshAccount = dev ? config.get('devSshAccount') : config.get('sshAccount')

    if (!sshAccount) {
      stderr.write(ansis.red('Missing sshAccount config variable.\n'))
      return 1
    }

    const parsedArgs = await Promise.all(args.map((x) => config.parseArg(x)))
    const result = await execC(sshCommand, [sshAccount, ...parsedArgs], { context })
    return result.exitCode
  }
}

export class RsyncCommand extends JoltCommand {
  static paths = [['rsync']]
  requiredCommands = ['rsync', 'ssh']

  dev = Option.Boolean('--dev', false)
  dryRun = Option.Boolean('--dry-run', false)
  args = Option.Proxy()

  async command(): Promise<number | undefined> {
    const {
      args,
      config,
      context,
      context: { stdout, stderr },
      dev,
      dryRun,
    } = this

    const sshCommand = config.command('ssh')
    const rsyncCommand = config.command('rsync')
    const sshPort = config.get('sshPort') || '22'
    const dryRunArg = dryRun ? '--dry-run' : ''
    const sshAccount = dev ? config.get('devSshAccount') : config.get('sshAccount')

    if (!sshAccount) {
      stderr.write(ansis.red('Missing sshAccount config variable.\n'))
      return 1
    }

    const params = {
      acc: sshAccount,
      contentFolder: (dev ? config.get('devFolder') : config.get('liveFolder')) ?? '',
    }

    const parsedArgs = await Promise.all(args.map((x) => config.parseArg(x, params)))
    const fullArgs = [`--rsh="${sshCommand} -p${sshPort}"`, '-av', dryRunArg, ...parsedArgs]
    stdout.write(ansis.blue(`Running command: ${rsyncCommand} ${fullArgs.join(' ')}...\n`))
    const result = await execC(rsyncCommand, fullArgs, { context })

    return result.exitCode
  }
}
