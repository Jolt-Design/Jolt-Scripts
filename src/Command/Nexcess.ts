import path from 'node:path'
import ansis from 'ansis'
import { Option } from 'clipanion'
import { execC, fileExists } from '../utils.js'
import JoltCommand from './JoltCommand.js'

export class NexcessDeployCommand extends JoltCommand {
  static paths = [['nexcess', 'deploy']]

  dev = Option.Boolean('--dev', false)
  requiredCommands = ['ssh']

  async command(): Promise<number | undefined> {
    const {
      config,
      context,
      context: { stdout, stderr },
      dev,
    } = this

    const sshCommand = config.command('ssh')

    if (!sshCommand) {
      stderr.write(ansis.red('❎ Unable to find SSH command.\n'))
      return 1
    }

    const sshAccount = dev ? config.get('devSshAccount') : config.get('sshAccount')

    if (!sshAccount) {
      stderr.write(ansis.red('❎ Missing sshAccount config variable.\n'))
      return 1
    }

    const deployFolder = dev ? config.get('devFolder') : config.get('liveFolder')
    const deployScript = config.get('nexcessDeployScript') ?? 'bin/nexcess-deploy-script.sh'
    const cleanupScript = config.get('nexcessCleanupScript') ?? 'bin/nexcess-cleanup.sh'
    const branch = dev ? config.get('devBranch') : config.get('branch')
    const repo = config.get('repo')
    const codeSubfolder = config.get('codeSubfolder')
    const now = new Date()
    const date = now
      .toISOString()
      .replace('T', '_')
      .replace(/:/g, '-')
      .replace(/\.\d+Z.*$/, '')

    const folder = `deploy-${date}`
    const deployScriptExists = await fileExists(path.join(process.cwd(), deployScript))
    const cleanupScriptExists = await fileExists(path.join(process.cwd(), cleanupScript))
    const commands = [`git clone --depth=1 --single-branch --branch=${branch} ${repo} ${folder}`]

    if (deployScriptExists) {
      commands.push(`echo Running deploy script ${deployScript}...`, `sh ~/${folder}/${deployScript} ${folder}`)
    } else {
      commands.push(`cd ~/${folder}/${codeSubfolder}`)

      if (cleanupScriptExists) {
        commands.push('echo Removing Nexcess code from repo...', `sh ../${cleanupScript}`)
      } else {
        commands.push('echo No cleanup script found, skipping...')
      }

      commands.push(
        'cd',
        'echo Copying...',
        `cp -ura ${folder}/${codeSubfolder}/. ${deployFolder}`,
        'echo Removing temp files...',
        `rm -rf ${folder}`,
        'echo Clearing site cache...',
        `cd ${deployFolder}`,
        '(wp cache-enabler clear || true)',
        'echo Done',
      )
    }

    const command = commands.join(' && ')
    const args = [sshAccount, '-T', '-C', `<<EOF\n${command}\nEOF`]

    stdout.write(ansis.blue(`❎ Cloning into ${folder} and deploying to ${deployFolder}...\n`))

    const result = await execC(sshCommand, args, { context })
    return result.exitCode
  }
}
