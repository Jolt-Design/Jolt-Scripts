import { userInfo } from 'node:os'
import ansis from 'ansis'
import { Option } from 'clipanion'
import * as t from 'typanion'
import { execC, which } from '../utils.js'
import JoltCommand from './JoltCommand.js'

type PluginDetails = {
  name: string
  status: string
  update: string
  version: string
  title: string
}

type ThemeDetails = {
  name: string
  status: string
  update: string
  version: string
  title: string
}

// Possible sub-arguments for the CLI command as of WP-CLI v2.12.0
const possibleCliArgs = [
  'alias',
  'cache',
  'check-update',
  'cmd-dump',
  'completions',
  'has-command',
  'info',
  'param-dump',
  'update',
  'version',
]

let maybeAddCliArg = true

export class WPCommand extends JoltCommand {
  static paths = [['wp']]
  wpArgs = Option.Proxy()

  async command(): Promise<number | undefined> {
    const { cli, wpArgs } = this

    // Proxy to wp-cli for backwards compatibility
    maybeAddCliArg = false
    const result = await cli.run(['wp-cli', ...wpArgs])
    maybeAddCliArg = true

    return result
  }
}

export class WPCLICommand extends JoltCommand {
  static paths = [['wp', 'cli'], ['wp-cli']]
  requiredCommands = ['docker', 'compose']

  wpArgs = Option.Proxy()

  async command(): Promise<number | undefined> {
    const {
      config,
      context,
      context: { stderr },
      wpArgs,
    } = this

    // Check if wp executable exists and no wp script in package.json
    const wpExecutable = await which('wp')
    const packageJson = await config.getPackageJson()
    const hasWpScript = packageJson?.scripts?.wp

    if (wpExecutable && !hasWpScript) {
      // Use wp executable directly
      let realArgs = wpArgs

      if (maybeAddCliArg && possibleCliArgs.includes(realArgs[0])) {
        realArgs = ['cli', ...realArgs]
      }

      const parsedArgs = await Promise.all(realArgs.map((x) => config.parseArg(x)))
      const result = await execC('wp', parsedArgs, { context, reject: false })
      return result.exitCode
    }

    // Fall back to container-based approach
    const containerName = await this.getContainerName()
    let realArgs = wpArgs
    if (maybeAddCliArg && possibleCliArgs.includes(realArgs[0])) {
      realArgs = ['cli', ...realArgs]
    }

    if (!containerName) {
      stderr.write(ansis.red(`Couldn't find a WP CLI container. Set it with the 'wpCliContainer' config key.\n`))
      return 1
    }
    const { uid, gid } = userInfo()
    // On Windows, uid is -1 so we shouldn't try to set the user
    const userArg = uid !== undefined && uid !== -1 && `--user='${uid}:${gid}'`
    const profile = await this.getContainerProfile(containerName)
    const [composeCommand, args] = await config.getComposeCommand()

    args.push(profile ? `--profile=${profile}` : '', 'run', '--rm', userArg || '', containerName, 'wp', ...realArgs)
    const parsedArgs = await Promise.all(args.map((x) => config.parseArg(x)))

    const result = await execC(composeCommand, parsedArgs, { context, reject: false })
    return result.exitCode
  }

  async getContainerName(): Promise<string | undefined> {
    const { config } = this

    if (config.has('wpCliContainer')) {
      return await config.get('wpCliContainer')
    }

    const composeConfig = await config.getComposeConfig()

    if (!composeConfig) {
      return undefined
    }

    for (const [key, service] of Object.entries(composeConfig.services)) {
      if (service.image?.match(/\bwp[_-]?cli\b/i)) {
        return key
      }
    }
  }

  async getContainerProfile(container: string): Promise<string | undefined> {
    const { config } = this

    if (config.has('wpCliContainerProfile')) {
      return await config.get('wpCliContainerProfile')
    }

    const composeConfig = await config.getComposeConfig()

    if (!composeConfig) {
      return undefined
    }

    const service = composeConfig.services[container]
    return service.profiles ? service.profiles[0] : undefined
  }
}

export class WPUpdateCommand extends JoltCommand {
  static paths = [['wp', 'update']]
  requiredCommands = ['git']

  skipCore = Option.Boolean('--skip-core', false, { description: 'Skip WordPress core updates' })
  skipPlugins = Option.Boolean('--skip-plugins', false, { description: 'Skip plugin updates' })
  skipThemes = Option.Boolean('--skip-themes', false, { description: 'Skip theme updates' })

  async command(): Promise<number | undefined> {
    const {
      config,
      context: { stdout, stderr },
      skipCore,
      skipPlugins,
      skipThemes,
      logo,
    } = this

    stdout.write(ansis.bold(`${logo} WordPress Updates\n\n`))

    // Load configuration
    const wpConfig = await config.loadWordPressConfig()

    if (!wpConfig) {
      stderr.write(ansis.red('Failed to load WordPress configuration\n'))
      return 1
    }

    // Use `jolt wp cli ...` via execC with the configured package runner

    let updatedPluginCount = 0
    let updatedThemeCount = 0
    let updatedCore = false

    // Get current status
    if (!skipPlugins) {
      stdout.write(ansis.cyan('🔌 Checking plugins...\n'))
      const yarnCommand = await config.command('yarn')
      const pluginsResult = await execC(yarnCommand, ['jolt', 'wp', 'cli', 'plugin', 'list', '--json'], {
        reject: false,
      })
      const pluginsJson = pluginsResult.exitCode === 0 ? String(pluginsResult.stdout || '') : null

      if (pluginsJson) {
        const plugins = this.parsePluginJson(pluginsJson)
        stdout.write(`Found ${plugins.length} plugins\n`)
      }
    }

    if (!skipThemes) {
      stdout.write(ansis.cyan('🎨 Checking themes...\n'))
      const yarnCommand = await config.command('yarn')
      const themesResult = await execC(yarnCommand, ['jolt', 'wp', 'cli', 'theme', 'list', '--json'], {
        reject: false,
      })
      const themesJson = themesResult.exitCode === 0 ? String(themesResult.stdout || '') : null
      if (themesJson) {
        const themes = this.parseThemeJson(themesJson)
        stdout.write(`Found ${themes.length} themes\n`)
      }
    }

    // We'll create the update branch only when we need to make our first commit
    const branchRef = { branch: undefined as string | undefined, created: false }

    // Disable git hooks temporarily
    const originalHookPath = await this.disableGitHooks()

    try {
      // Update plugins
      if (!skipPlugins) {
        stdout.write(ansis.cyan('🔌 Updating plugins...\n'))

        const yarnCommand = await config.command('yarn')
        const pluginsResult = await execC(yarnCommand, ['jolt', 'wp', 'cli', 'plugin', 'list', '--json'], {
          reject: false,
        })

        const pluginsJson = pluginsResult.exitCode === 0 ? String(pluginsResult.stdout || '') : null

        if (pluginsJson) {
          const plugins = this.parsePluginJson(pluginsJson)

          for (const plugin of plugins) {
            const didUpdate = await this.maybeUpdatePlugin(plugin, wpConfig, branchRef)
            if (didUpdate) {
              updatedPluginCount++
            }
          }
        }
      }

      // Update themes
      if (!skipThemes) {
        stdout.write(ansis.cyan('🎨 Updating themes...\n'))

        const yarnCommand = await config.command('yarn')
        const themesResult = await execC(yarnCommand, ['jolt', 'wp', 'cli', 'theme', 'list', '--json'], {
          reject: false,
        })
        const themesJson = themesResult.exitCode === 0 ? String(themesResult.stdout || '') : null

        if (themesJson) {
          const themes = this.parseThemeJson(themesJson)

          for (const theme of themes) {
            const didUpdate = await this.maybeUpdateTheme(theme, wpConfig, branchRef)
            if (didUpdate) {
              updatedThemeCount++
            }
          }
        }
      }

      // Update core
      if (!skipCore) {
        stdout.write(ansis.cyan('📦 Checking WordPress core...\n'))
        updatedCore = await this.maybeUpdateCore(wpConfig, branchRef)
      }
    } finally {
      await this.rollbackGitHooks(originalHookPath)
    }

    // Summary
    stdout.write(ansis.green('\n✅ Update complete!\n'))
    stdout.write(ansis.cyan(`🔌 Updated ${updatedPluginCount} plugins\n`))
    stdout.write(ansis.cyan(`🎨 Updated ${updatedThemeCount} themes\n`))

    if (updatedCore) {
      stdout.write(ansis.cyan('📦 Updated WordPress core\n'))
    }

    const totalUpdates = updatedPluginCount + updatedThemeCount + (updatedCore ? 1 : 0)
    const yarnCommand = await config.command('yarn')

    if (totalUpdates > 0 && branchRef.created) {
      stdout.write(ansis.yellow('\nNext steps:\n'))
      stdout.write(`• Review updates: ${ansis.dim(`${yarnCommand} jolt wp update modify`)}\n`)
      // Use root config value directly
      stdout.write(`• Merge to ${await config.get('branch')}: ${ansis.dim(`${yarnCommand} jolt wp update merge`)}\n`)
    } else if (totalUpdates === 0) {
      stdout.write(ansis.green('\n✅ No updates available - staying on current branch\n'))
    }

    return 0
  }

  // Note: WP CLI invocations run via `yarn jolt wp cli ...` using execC directly.

  private parsePluginJson(pluginsJson: string): PluginDetails[] {
    // Trim off any preceding warnings, try to look for the start of the actual JSON.
    const trimmed = pluginsJson.substring(pluginsJson.indexOf('[{'))
    const allPlugins = JSON.parse(trimmed)
    return allPlugins.filter((plugin: PluginDetails) => !['dropin', 'must-use'].includes(plugin.status))
  }

  private parseThemeJson(themeJson: string): ThemeDetails[] {
    // Trim off any preceding warnings, try to look for the start of the actual JSON.
    const trimmed = themeJson.substring(themeJson.indexOf('[{'))
    return JSON.parse(trimmed)
  }

  // (No helper) obtain the package runner directly via config.command('yarn') where needed

  private async createBranch(): Promise<string> {
    const { config, context } = this
    const isoDate = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '_').slice(0, -5)
    const branchName = `joltWpUpdate/${isoDate}`

    const gitCommand = await config.command('git')
    await execC(gitCommand, ['checkout', '-b', branchName], { context })
    return branchName
  }

  private async ensureBranchCreated(
    _wpConfig: WordPressConfig,
    branchRef: { branch?: string; created: boolean },
  ): Promise<string> {
    if (!branchRef.created) {
      branchRef.branch = await this.createBranch()
      branchRef.created = true
      const {
        context: { stdout },
      } = this
      stdout.write(ansis.green(`📋 Created update branch ${branchRef.branch}\n`))
    }
    return branchRef.branch as string
  }

  private async disableGitHooks(): Promise<string> {
    const { config, context } = this
    const gitCommand = await config.command('git')
    try {
      const result = await execC(gitCommand, ['config', '--get', 'core.hooksPath'], { context, reject: false })
      const originalHookPath = String(result.stdout || '').trim()
      await execC(gitCommand, ['config', 'core.hooksPath', '/dev/null'], { context })
      return originalHookPath
    } catch {
      await execC(gitCommand, ['config', 'core.hooksPath', '/dev/null'], { context })
      return ''
    }
  }

  private async rollbackGitHooks(originalHookPath: string): Promise<void> {
    const { config, context } = this
    const gitCommand = await config.command('git')
    if (originalHookPath) {
      await execC(gitCommand, ['config', 'core.hooksPath', originalHookPath], { context })
    } else {
      await execC(gitCommand, ['config', '--unset', 'core.hooksPath'], { context, reject: false })
    }
  }

  private async maybeUpdatePlugin(
    plugin: PluginDetails,
    wpConfig: WordPressConfig,
    branchRef: { branch?: string; created: boolean },
  ): Promise<boolean> {
    const {
      context: { stdout },
    } = this

    if (wpConfig.doNotUpdate.includes(plugin.name)) {
      stdout.write(ansis.dim(`  Skipping ${plugin.name} (configured to skip)\n`))
      return false
    }

    stdout.write(`  Checking ${plugin.name}...`)

    if (plugin.update === 'available') {
      stdout.write(ansis.green(' updating\n'))
      return await this.updatePlugin(plugin, wpConfig, branchRef)
    }

    if (plugin.update === 'none') {
      stdout.write(ansis.dim(' up to date\n'))
    } else if (plugin.update === 'version higher than expected') {
      stdout.write(ansis.yellow(` local version ${plugin.version} is higher than remote\n`))
    } else {
      stdout.write(ansis.red(` unknown status: ${plugin.update}\n`))
    }

    return false
  }

  private async maybeUpdateTheme(
    theme: ThemeDetails,
    wpConfig: WordPressConfig,
    branchRef: { branch?: string; created: boolean },
  ): Promise<boolean> {
    const {
      context: { stdout },
    } = this

    if (wpConfig.doNotUpdate.includes(theme.name)) {
      stdout.write(ansis.dim(`  Skipping ${theme.name} (configured to skip)\n`))
      return false
    }

    stdout.write(`  Checking ${theme.name}...`)

    if (theme.update === 'available') {
      stdout.write(ansis.green(' updating\n'))
      return await this.updateTheme(theme, wpConfig, branchRef)
    }

    if (theme.update === 'none') {
      stdout.write(ansis.dim(' up to date\n'))
    } else if (theme.update === 'version higher than expected') {
      stdout.write(ansis.yellow(` local version ${theme.version} is higher than remote\n`))
    } else {
      stdout.write(ansis.red(` unknown status: ${theme.update}\n`))
    }

    return false
  }

  private async updatePlugin(
    plugin: PluginDetails,
    wpConfig: WordPressConfig,
    branchRef: { branch?: string; created: boolean },
  ): Promise<boolean> {
    const {
      config,
      context,
      context: { stdout, stderr },
    } = this

    try {
      const gitCommand = await config.command('git')
      const details = await this.getPluginDetails(plugin.name)
      if (!details) {
        return false
      }

      const fromVersion = details.version
      const prettyTitle = this.cleanTitle(details.title)
      const location = `${wpConfig.pluginFolder}/${plugin.name}`

      const yarnCommand = await config.command('yarn')
      const updateResult = await execC(yarnCommand, ['jolt', 'wp', 'cli', 'plugin', 'update', plugin.name], {
        reject: false,
      })
      const updateResultStr = updateResult.exitCode === 0 ? String(updateResult.stdout || '') : null

      if (!updateResultStr) {
        stderr.write(ansis.red(`    Error updating ${plugin.name}\n`))
        return false
      }

      const newDetails = await this.getPluginDetails(plugin.name)
      if (!newDetails || newDetails.version === details.version) {
        stderr.write(ansis.red('    Update failed!\n'))
        return false
      }

      // Ensure branch is created before making our first commit
      await this.ensureBranchCreated(wpConfig, branchRef)

      const commitMessage = this.sanitizeCommitMessage(`Update ${prettyTitle} to ${newDetails.version}`)

      await execC(gitCommand, ['add', location], { context })
      await execC(gitCommand, ['commit', '-m', commitMessage], {
        context,
        shell: false,
        env: { SKIP: 'prepare-commit-msg' },
      })

      stdout.write(ansis.green(`    Updated ${prettyTitle} from ${fromVersion} to ${newDetails.version}\n`))
      return true
    } catch (error) {
      stderr.write(ansis.red(`    Error updating ${plugin.name}: ${error}\n`))
      return false
    }
  }

  private async updateTheme(
    theme: ThemeDetails,
    wpConfig: WordPressConfig,
    branchRef: { branch?: string; created: boolean },
  ): Promise<boolean> {
    const {
      config,
      context,
      context: { stdout, stderr },
    } = this

    try {
      const gitCommand = await config.command('git')
      const details = await this.getThemeDetails(theme.name)
      if (!details) {
        return false
      }

      const fromVersion = details.version
      const prettyTitle = this.cleanTitle(details.title)
      const location = `${wpConfig.themeFolder}/${theme.name}`

      const yarnCommand = await config.command('yarn')
      const updateResult = await execC(yarnCommand, ['jolt', 'wp', 'cli', 'theme', 'update', theme.name], {
        reject: false,
      })
      const updateResultStr = updateResult.exitCode === 0 ? String(updateResult.stdout || '') : null

      if (!updateResultStr) {
        stderr.write(ansis.red(`    Error updating ${theme.name}\n`))
        return false
      }

      const newDetails = await this.getThemeDetails(theme.name)
      if (!newDetails || newDetails.version === details.version) {
        stderr.write(ansis.red('    Update failed!\n'))
        return false
      }

      // Ensure branch is created before making our first commit
      await this.ensureBranchCreated(wpConfig, branchRef)

      const commitMessage = this.sanitizeCommitMessage(`Update theme ${prettyTitle} to ${newDetails.version}`)

      await execC(gitCommand, ['add', location], { context })
      await execC(gitCommand, ['commit', '-m', commitMessage], {
        context,
        shell: false,
        env: { SKIP: 'prepare-commit-msg' },
      })

      stdout.write(ansis.green(`    Updated theme ${prettyTitle} from ${fromVersion} to ${newDetails.version}\n`))
      return true
    } catch (error) {
      stderr.write(ansis.red(`    Error updating ${theme.name}: ${error}\n`))
      return false
    }
  }

  private async getPluginDetails(pluginName: string): Promise<PluginDetails | null> {
    return await this.getDetails(pluginName, 'plugin')
  }

  private async getThemeDetails(themeName: string): Promise<ThemeDetails | null> {
    return await this.getDetails(themeName, 'theme')
  }

  private async getDetails(name: string, type: 'plugin' | 'theme'): Promise<PluginDetails | ThemeDetails | null> {
    const { config } = this
    const cmdType = type === 'plugin' ? 'plugin' : 'theme'

    try {
      const yarnCommand = await config.command('yarn')
      const detailsResult = await execC(yarnCommand, ['jolt', 'wp', 'cli', cmdType, 'get', '--json', name], {
        reject: false,
      })
      const out = detailsResult.exitCode === 0 ? String(detailsResult.stdout || '') : null

      if (!out) {
        return null
      }

      let output = String(out || '')

      if (output.startsWith('$')) {
        // Older Yarn versions include the script name in stdout so we need to trim the first line off
        output = output.substring(1 + output.indexOf('\n'))
      }

      // Look for the start of the JSON to trim off PHP warnings
      const trimmed = output.substring(output.indexOf('{"')).trim()

      return JSON.parse(trimmed)
    } catch {
      return null
    }
  }

  private cleanTitle(name: string): string {
    return name.split(/[|:]/i)[0].trim()
  }

  private sanitizeCommitMessage(message: string): string {
    // Replace any problematic characters that might cause issues in commit messages
    return message
      .replace(/[""'']/g, '"') // Normalize quotes
      .replace(/[^\x20-\x7E]/g, '') // Remove non-ASCII characters
      .trim()
  }

  private async maybeUpdateCore(
    wpConfig: WordPressConfig,
    branchRef: { branch?: string; created: boolean },
  ): Promise<boolean> {
    const {
      context: { stdout },
    } = this

    const newVersion = await this.hasCoreUpdate()

    if (!newVersion) {
      stdout.write(ansis.dim('  WordPress core is up to date\n'))
      return false
    }

    stdout.write(ansis.green(`  Updating WordPress core to ${newVersion}\n`))

    const shouldStash = await this.hasGitChanges(wpConfig.wpRoot)

    if (shouldStash) {
      stdout.write(ansis.yellow('    Stashing changes temporarily...\n'))
      await this.stashChanges()
    }

    try {
      await this.doCoreUpdate(wpConfig.wpRoot, newVersion, wpConfig, branchRef)
      stdout.write(ansis.green(`    Updated WordPress core to ${newVersion}\n`))
      return true
    } finally {
      if (shouldStash) {
        stdout.write(ansis.yellow('    Restoring stashed changes...\n'))
        await this.unstashChanges()
      }
    }
  }

  private async hasCoreUpdate(): Promise<string | false> {
    const { config } = this
    try {
      const yarnCommand = await config.command('yarn')
      const coreResult = await execC(yarnCommand, ['jolt', 'wp', 'cli', 'core', 'check-update', '--json'], {
        reject: false,
      })
      if (!coreResult || coreResult.exitCode !== 0) {
        return false
      }

      const stdoutStr = String(coreResult.stdout || '')

      if (!stdoutStr.trim() || stdoutStr.trim() === '[]') {
        return false
      }

      const trimmed = stdoutStr.substring(stdoutStr.indexOf('[{'))
      const parsed = JSON.parse(trimmed)

      return parsed[0]?.version || false
    } catch {
      return false
    }
  }

  private async hasGitChanges(path: string): Promise<boolean> {
    const { config, context } = this

    try {
      const gitCommand = await config.command('git')
      const result = await execC(gitCommand, ['status', '--porcelain=v1', '--', path], {
        context,
        reject: false,
      })
      return String(result.stdout || '').trim() !== ''
    } catch {
      return false
    }
  }

  private async stashChanges(): Promise<void> {
    const { config, context } = this
    const date = new Date().toISOString()

    const gitCommand = await config.command('git')
    await execC(gitCommand, ['add', '.'], { context })
    await execC(gitCommand, ['stash', 'save', '--', `Automated stash by Jolt WP Updater at ${date}`], {
      context,
      shell: false,
    })
  }

  private async unstashChanges(): Promise<void> {
    const { config, context } = this

    const gitCommand = await config.command('git')
    await execC(gitCommand, ['stash', 'pop'], { context })
    await execC(gitCommand, ['reset', 'HEAD', '--'], { context })
  }

  private async doCoreUpdate(
    path: string,
    version: string,
    wpConfig: WordPressConfig,
    branchRef: { branch?: string; created: boolean },
  ): Promise<void> {
    const { config, context } = this

    // Ensure branch is created before making our first commit
    await this.ensureBranchCreated(wpConfig, branchRef)

    const gitCommand = await config.command('git')
    const yarnCommand = await config.command('yarn')
    await execC(yarnCommand, ['jolt', 'wp', 'cli', 'core', 'update'], { context, reject: false })
    await execC(gitCommand, ['add', path], { context })

    const commitMessage = this.sanitizeCommitMessage(`Update WordPress to ${version}`)
    await execC(gitCommand, ['commit', '-m', commitMessage], {
      context,
      shell: false,
      env: { SKIP: 'prepare-commit-msg' },
    })
  }
}

export class WPUpdateMergeCommand extends JoltCommand {
  static paths = [['wp', 'update', 'merge']]
  requiredCommands = ['git']

  rebase = Option.Boolean('--rebase', false, {
    description: 'Use rebase instead of merge',
  })

  ffOnly = Option.Boolean('--ff-only', false, {
    description: 'Only allow fast-forward merges',
  })

  noFf = Option.Boolean('--no-ff', false, {
    description: 'Create a merge commit even when the merge resolves as a fast-forward',
  })

  static schema = [
    t.hasMutuallyExclusiveKeys(['rebase', 'ffOnly', 'noFf'], {
      missingIf: 'falsy',
    }),
  ]

  async command(): Promise<number | undefined> {
    const {
      config,
      context,
      context: { stdout, stderr },
      logo,
    } = this

    const operationTitle = this.rebase ? 'WordPress Update Rebase' : 'WordPress Update Merge'
    stdout.write(`${logo} ${ansis.bold(operationTitle)}\n\n`)

    const wpConfig = await config.loadWordPressConfig()
    if (!wpConfig) {
      stderr.write(ansis.red('Failed to load WordPress configuration\n'))
      return 1
    }

    try {
      const gitCommand = await config.command('git')

      // Get current branch
      const currentBranchResult = await execC(gitCommand, ['branch', '--show-current'])
      const currentBranch = String(currentBranchResult.stdout || '').trim()

      if (!currentBranch.startsWith('joltWpUpdate/')) {
        stderr.write(ansis.red('Not currently on a WordPress update branch\n'))
        return 1
      }

      const targetBranch = (await config.get('branch')) || 'master'

      stdout.write(ansis.cyan(`📋 Switching to ${targetBranch}...\n`))
      await execC(gitCommand, ['switch', targetBranch], { context })

      if (this.rebase) {
        stdout.write(ansis.cyan(`📋 Rebasing ${currentBranch}...\n`))
        await execC(gitCommand, ['rebase', currentBranch], { context })
      } else {
        const mergeArgs = ['merge']
        if (this.ffOnly) {
          mergeArgs.push('--ff-only')
        } else if (this.noFf) {
          mergeArgs.push('--no-ff')
        }
        mergeArgs.push(currentBranch)

        const mergeStrategy = this.ffOnly ? ' (fast-forward only)' : this.noFf ? ' (no fast-forward)' : ''
        stdout.write(ansis.cyan(`📋 Merging ${currentBranch}${mergeStrategy}...\n`))
        await execC(gitCommand, mergeArgs, { context })
      }

      const operation = this.rebase ? 'rebased' : 'merged'
      stdout.write(ansis.green(`✅ Successfully ${operation} WordPress updates!\n`))
      return 0
    } catch (error) {
      stderr.write(ansis.red(`Error during merge: ${error}\n`))
      return 1
    }
  }
}

export class WPUpdateCleanCommand extends JoltCommand {
  static paths = [['wp', 'update', 'clean']]
  requiredCommands = ['git']

  dryRun = Option.Boolean('--dry-run', false, { description: 'Show what would be deleted without actually deleting' })
  deleteUnmerged = Option.Boolean('--delete-unmerged', false, {
    description: 'Delete unmerged branches (default: only merged branches)',
  })

  async command(): Promise<number | undefined> {
    const {
      config,
      context: { stdout, stderr },
      logo,
      dryRun,
      deleteUnmerged,
    } = this

    const operationTitle = dryRun ? 'WordPress Update Branch Cleanup (Dry Run)' : 'WordPress Update Branch Cleanup'
    stdout.write(`${logo} ${ansis.bold(operationTitle)}\n\n`)

    const wpConfig = await config.loadWordPressConfig()
    if (!wpConfig) {
      stderr.write(ansis.red('Failed to load WordPress configuration\n'))
      return 1
    }

    try {
      const gitCommand = await config.command('git')

      // Get current branch to avoid deleting it
      const currentBranchResult = await execC(gitCommand, ['branch', '--show-current'], {
        reject: false,
      })
      const currentBranch = String(currentBranchResult.stdout || '').trim()

      // List all branches with our prefix
      const branchListResult = await execC(gitCommand, ['branch', '--list', 'joltWpUpdate/*'], {
        reject: false,
      })

      if (branchListResult.exitCode !== 0) {
        stderr.write(ansis.red('Failed to list branches\n'))
        return 1
      }

      const branchOutput = String(branchListResult.stdout || '').trim()
      if (!branchOutput) {
        stdout.write(ansis.green('✅ No WordPress update branches found to clean\n'))
        return 0
      }

      // Parse branch names (remove leading spaces and asterisks)
      const branches = branchOutput
        .split('\n')
        .map((line) => line.trim().replace(/^\*\s*/, ''))
        .filter((branch) => branch.startsWith('joltWpUpdate/') && branch !== currentBranch)

      if (branches.length === 0) {
        if (currentBranch.startsWith('joltWpUpdate/')) {
          stdout.write(
            ansis.yellow('⚠️ Currently on a WordPress update branch. Switch to another branch first to clean it.\n'),
          )
        } else {
          stdout.write(ansis.green('✅ No WordPress update branches found to clean\n'))
        }
        return 0
      }

      if (dryRun) {
        // Dry run - show what would be deleted without actually deleting
        const deleteMode = deleteUnmerged ? 'force delete' : 'delete merged'
        for (const branch of branches) {
          stdout.write(ansis.cyan(`🔍 Would ${deleteMode} ${branch}\n`))
        }

        const modeNote = deleteUnmerged
          ? ' (including unmerged branches)'
          : ' (merged branches only, unmerged will be skipped)'

        stdout.write(
          ansis.cyan(
            `\n🔍 Dry run complete. Would process ${branches.length} WordPress update branch${branches.length === 1 ? '' : 'es'}${modeNote}\n`,
          ),
        )
      } else {
        // Actually delete branches
        const deleteFlag = deleteUnmerged ? '-D' : '-d'
        let deletedCount = 0
        let skippedCount = 0

        for (const branch of branches) {
          try {
            const deleteResult = await execC(gitCommand, ['branch', deleteFlag, branch], { reject: false })
            if (deleteResult.exitCode === 0) {
              stdout.write(ansis.green(`✅ Deleted ${branch}\n`))
              deletedCount++
            } else {
              if (!deleteUnmerged && String(deleteResult.stderr || '').includes('not fully merged')) {
                stdout.write(ansis.yellow(`⚠️ Skipped ${branch} (unmerged - use --delete-unmerged to force)\n`))
                skippedCount++
              } else {
                stderr.write(ansis.red(`❌ Failed to delete ${branch}\n`))
              }
            }
          } catch (error) {
            stderr.write(ansis.red(`❌ Error deleting ${branch}: ${error}\n`))
          }
        }

        if (deletedCount > 0 || skippedCount > 0) {
          const messages: string[] = []
          if (deletedCount > 0) {
            messages.push(`deleted ${deletedCount} branch${deletedCount === 1 ? '' : 'es'}`)
          }
          if (skippedCount > 0) {
            messages.push(`skipped ${skippedCount} unmerged branch${skippedCount === 1 ? '' : 'es'}`)
          }
          stdout.write(ansis.green(`\n🎉 Successfully ${messages.join(', ')}\n`))
        }
      }

      return 0
    } catch (error) {
      stderr.write(ansis.red(`Error during cleanup: ${error}\n`))
      return 1
    }
  }
}

export class WPUpdateModifyCommand extends JoltCommand {
  static paths = [['wp', 'update', 'modify']]
  requiredCommands = ['git']

  autostash = Option.Boolean('--autostash', false, {
    description: 'Automatically stash and unstash changes before and after the rebase',
  })

  async command(): Promise<number | undefined> {
    const {
      config,
      context,
      context: { stdout, stderr },
      logo,
    } = this

    stdout.write(`${logo} ${ansis.bold('WordPress Update Interactive Rebase')}\n\n`)

    const wpConfig = await config.loadWordPressConfig()
    if (!wpConfig) {
      stderr.write(ansis.red('Failed to load WordPress configuration\n'))
      return 1
    }

    try {
      const gitCommand = await config.command('git')
      // Get current branch
      const currentBranchResult = await execC(gitCommand, ['branch', '--show-current'])
      const currentBranch = String(currentBranchResult.stdout || '').trim()

      if (!currentBranch.startsWith('joltWpUpdate/')) {
        stderr.write(ansis.red('Not currently on a WordPress update branch\n'))
        return 1
      }

      // Count commits since branching from main
      const branchName = (await config.get('branch')) || 'master'
      const commitCountResult = await execC(gitCommand, ['rev-list', '--count', `${branchName}..HEAD`], {
        reject: false,
      })

      if (commitCountResult.exitCode !== 0) {
        stderr.write(ansis.red('Could not determine commit count\n'))
        return 1
      }

      const commitCount = Number.parseInt(String(commitCountResult.stdout || '').trim(), 10)

      if (commitCount === 0) {
        stdout.write(ansis.yellow('No commits to rebase\n'))
        return 0
      }

      stdout.write(ansis.cyan(`📋 Starting interactive rebase for ${commitCount} commits...\n`))

      // Run interactive rebase
      const rebaseArgs = ['rebase', '-i', `HEAD~${commitCount}`]

      if (this.autostash) {
        rebaseArgs.push('--autostash')
      }

      const rebaseResult = await execC(gitCommand, rebaseArgs, {
        context,
        reject: false,
      })

      if (rebaseResult.exitCode === 0) {
        stdout.write(ansis.green('✅ Interactive rebase completed!\n'))
      } else {
        stderr.write(ansis.red('Interactive rebase was cancelled or failed\n'))
        return rebaseResult.exitCode
      }

      return 0
    } catch (error) {
      stderr.write(ansis.red(`Error during rebase: ${error}\n`))
      return 1
    }
  }
}
