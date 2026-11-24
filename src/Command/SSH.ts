import ansis from 'ansis'
import { Command, Option } from 'clipanion'
import { execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'

export class SSHCommand extends JoltCommand {
  static paths = [['ssh']]

  static usage = Command.Usage({
    category: 'Hosting',
    description: 'SSH to the configured server, passing any further arguments to ssh',
    details: `
      Connects to \`sshAccount\` (or \`devSshAccount\` with \`--dev\`). Arguments after the options are passed to ssh,
      with placeholders resolved.

      Requires ssh and the \`sshAccount\` (or \`devSshAccount\`) config key.
    `,
    examples: [
      ['Open a shell on the live server', '$0 ssh'],
      ['Run one command on the dev server', '$0 --dev ssh ls -la'],
    ],
  })
  requiredCommands = ['ssh']

  dev = Option.Boolean('--dev', false, { description: 'Connect to development environment' })
  args = Option.Proxy()

  getRequiredConfig(): string[] {
    return this.dev ? ['devSshAccount'] : ['sshAccount']
  }

  getProxyArgs(): string[] {
    return this.args
  }

  async command(): Promise<number | undefined> {
    const { args, config, context, dev } = this

    const sshCommand = await config.command('ssh')
    const sshAccount = dev ? await config.get('devSshAccount') : await config.get('sshAccount')

    // sshAccount is guaranteed to exist due to getRequiredConfig() validation
    const parsedArgs = await Promise.all(args.map((x) => config.parseArg(x)))
    const result = await execC(sshCommand, [sshAccount as string, ...parsedArgs], { context, reject: false })
    return result.exitCode
  }
}

export class RsyncCommand extends JoltCommand {
  static paths = [['rsync']]

  static usage = Command.Usage({
    category: 'Hosting',
    description: 'Run rsync over SSH against the configured server, passing any further arguments to rsync',
    details: `
      Runs \`rsync -av\` over ssh using \`sshAccount\` and \`sshPort\` (default 22), or \`devSshAccount\` with \`--dev\`.
      Further arguments go to rsync. In them, \`{arg:acc}\` is the SSH account and \`{arg:contentFolder}\` is
      \`liveFolder\` (or \`devFolder\` with \`--dev\`).

      Requires rsync, ssh and the \`sshAccount\` (or \`devSshAccount\`) config key.
    `,
    examples: [
      [
        'Preview syncing a folder to the live content folder',
        '$0 rsync --dry-run ./code/ {arg:acc}:~/{arg:contentFolder}',
      ],
    ],
  })
  requiredCommands = ['rsync', 'ssh']

  dev = Option.Boolean('--dev', false, { description: 'Sync to development environment' })
  dryRun = Option.Boolean('--dry-run', false, { description: 'Show what would be synced without actually syncing' })
  args = Option.Proxy()

  getRequiredConfig(): string[] {
    return this.dev ? ['devSshAccount'] : ['sshAccount']
  }

  getProxyArgs(): string[] {
    return this.args
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
    stdout.write(ansis.blue(`Running command: ${config.redact(`${rsyncCommand} ${fullArgs.join(' ')}`)}...\n`))
    const result = await execC(rsyncCommand, fullArgs, { context, reject: false })

    return result.exitCode
  }
}
