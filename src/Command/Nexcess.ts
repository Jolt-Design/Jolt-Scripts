import path from 'node:path'
import ansis from 'ansis'
import { Command, Option } from 'clipanion'
import { fileExists } from '../utils.js'
import JoltCommand from './JoltCommand.js'

export class NexcessDeployCommand extends JoltCommand {
  static paths = [['nexcess', 'deploy']]

  static usage = Command.Usage({
    category: 'Hosting',
    description: 'Deploy the latest commit of the configured branch to a Nexcess server over SSH',
    details: `
      On the server, clones \`repo\` (branch \`branch\`, or \`devBranch\` with \`--dev\`) into a temporary folder, copies
      \`codeSubfolder\` into \`liveFolder\` (\`devFolder\` with \`--dev\`), deletes the temporary folder and clears the
      Cache Enabler cache. If \`bin/nexcess-deploy-script.sh\` exists locally, it is run on the server instead of the
      copy steps. \`nexcessCleanupScript\` can remove files that shouldn't be deployed.

      This deploys what is on the remote repo, not local changes (see \`nexcess deploy-local\`).

      Requires ssh and the config keys \`repo\`, \`codeSubfolder\`, \`liveFolder\` and \`branch\` (or \`devFolder\` and
      \`devBranch\` with \`--dev\`).
    `,
    examples: [
      ['Deploy to live', '$0 nexcess deploy'],
      ['Deploy to the dev environment', '$0 nexcess deploy --dev'],
    ],
  })

  dev = Option.Boolean('--dev', false, { description: 'Deploy to development environment' })
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

    const [deployFolder, deployScript, cleanupScript, branch, repo, codeSubfolder] = await Promise.all([
      dev ? config.get('devFolder') : config.get('liveFolder'),
      config.get('nexcessDeployScript').then((script) => script ?? 'bin/nexcess-deploy-script.sh'),
      config.get('nexcessCleanupScript').then((script) => script ?? 'bin/nexcess-cleanup.sh'),
      dev ? config.get('devBranch') : config.get('branch'),
      config.get('repo'),
      config.get('codeSubfolder'),
    ])
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

  static usage = Command.Usage({
    category: 'Hosting',
    description: 'Deploy a specific commit to a Nexcess server over SSH',
    details: `
      Works like \`nexcess deploy\` but checks out the given commit instead of a branch. Use it to roll back.

      Requires ssh and the config keys \`repo\`, \`codeSubfolder\` and \`liveFolder\` (or \`devFolder\` with \`--dev\`).
    `,
    examples: [['Roll live back to a commit', '$0 nexcess deploy-specific 1a2b3c4d']],
  })

  dev = Option.Boolean('--dev', false, { description: 'Deploy to development environment' })
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

  static usage = Command.Usage({
    category: 'Hosting',
    description: 'Rsync the local `codeSubfolder` to a Nexcess server, without going through Git',
    details: `
      Runs \`jolt rsync\` for \`./<codeSubfolder>/\` into the server's content folder, excluding anything listed in
      \`.rsyncignore\` if that file exists. Use \`--dry-run\` first to see what would change.

      Requires rsync, ssh and the \`codeSubfolder\` config key, plus the SSH account keys that \`rsync\` needs.
    `,
    examples: [
      ['Preview a local deploy to dev', '$0 nexcess deploy-local --dev --dry-run'],
      ['Deploy local code to live', '$0 nexcess deploy-local'],
    ],
  })

  dev = Option.Boolean('--dev', false, { description: 'Deploy to development environment' })
  dryRun = Option.Boolean('--dry-run', false, { description: 'Show what would be synced without actually syncing' })
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
