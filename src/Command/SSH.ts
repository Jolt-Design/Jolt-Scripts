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

    const result = await execC(sshCommand, [sshAccount, ...args], { context })
    return result.exitCode
  }
}
