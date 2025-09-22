import path from 'node:path'
import ansis from 'ansis'
import { Option } from 'clipanion'
import { fileExists } from '../utils.js'
import JoltCommand from './JoltCommand.js'

export class NexcessDeployCommand extends JoltCommand {
  static paths = [['nexcess', 'deploy']]

  dev = Option.Boolean('--dev', false)
  requiredCommands = ['ssh']

  getRequiredConfig(): string[] {
    const baseConfigs = ['repo', 'codeSubfolder']
    const additionalConfigs = this.dev ? ['devFolder', 'devBranch'] : ['liveFolder', 'branch']
    return [...baseConfigs, ...additionalConfigs]
  }

  async command(): Promise<number | undefined> {
    const {
      cli,
      config,
      context: { stdout },
      dev,
    } = this

    const deployFolder = dev ? await config.get('devFolder') : await config.get('liveFolder')
    const deployScript = (await config.get('nexcessDeployScript')) ?? 'bin/nexcess-deploy-script.sh'
    const cleanupScript = (await config.get('nexcessCleanupScript')) ?? 'bin/nexcess-cleanup.sh'
    const branch = dev ? await config.get('devBranch') : await config.get('branch')
    const repo = await config.get('repo')
    const codeSubfolder = await config.get('codeSubfolder')
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
    const args = ['ssh', '-T', '-C', `<<EOF\n${command}\nEOF`]

    stdout.write(ansis.blue(`❎ Cloning into ${folder} and deploying to ${deployFolder}...\n`))

    const result = await cli.run(args)
    return result
  }
}

export class NexcessDeploySpecificCommand extends JoltCommand {
  static paths = [['nexcess', 'deploy-specific']]

  dev = Option.Boolean('--dev', false)
  commit = Option.String({ required: true })
  requiredCommands = ['ssh']

  getRequiredConfig(): string[] {
    const baseConfigs = ['repo', 'codeSubfolder']
    const additionalConfigs = this.dev ? ['devFolder'] : ['liveFolder']
    return [...baseConfigs, ...additionalConfigs]
  }

  async command(): Promise<number | undefined> {
    const {
      cli,
      config,
      context: { stdout, stderr },
      dev,
      commit,
    } = this

    if (!commit) {
      stderr.write(ansis.red('⚡ Commit parameter must be specified\n'))
      return 2
    }

    const deployFolder = dev ? await config.get('devFolder') : await config.get('liveFolder')
    const deployScript = (await config.get('nexcessDeployScript')) ?? 'bin/nexcess-deploy-script.sh'
    const cleanupScript = (await config.get('nexcessCleanupScript')) ?? 'bin/nexcess-cleanup.sh'
    const repo = await config.get('repo')
    const codeSubfolder = await config.get('codeSubfolder')
    const now = new Date()
    const date = now
      .toISOString()
      .replace('T', '_')
      .replace(/:/g, '-')
      .replace(/\.\d+Z.*$/, '')

    const folder = `deploy-${date}-${commit.slice(0, 8)}`
    const deployScriptExists = await fileExists(path.join(process.cwd(), deployScript))
    const cleanupScriptExists = await fileExists(path.join(process.cwd(), cleanupScript))
    const commands = [`git clone --depth=1 ${repo} ${folder}`, `cd ~/${folder}`, `git checkout ${commit}`]

    if (deployScriptExists) {
      commands.push('cd', `echo Running deploy script ${deployScript}...`, `sh ~/${folder}/${deployScript} ${folder}`)
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
    const args = ['ssh', '-T', '-C', `<<EOF\n${command}\nEOF`]

    stdout.write(ansis.blue(`⚡ Cloning commit ${commit} into ${folder} and deploying to ${deployFolder}...\n`))

    const result = await cli.run(args)
    return result
  }
}

export class NexcessDeployLocalCommand extends JoltCommand {
  static paths = [['nexcess', 'deploy-local']]

  dev = Option.Boolean('--dev', false)
  dryRun = Option.Boolean('--dry-run', false)
  requiredCommands = ['rsync', 'ssh']
  requiredConfig = ['codeSubfolder']

  async command(): Promise<number | undefined> {
    const { cli, config, dev, dryRun } = this
    const excludeArg = (await fileExists('.rsyncignore')) ? '--exclude-from=.rsyncignore' : ''
    const devArg = dev ? '--dev' : ''
    const dryRunArg = dryRun ? '--dry-run' : ''

    return await cli.run(
      [
        'rsync',
        devArg,
        dryRunArg,
        excludeArg,
        `./${await config.get('codeSubfolder')}/`,
        '{arg:acc}:~/{arg:contentFolder}',
      ].filter((x) => !!x),
    )
  }
}
