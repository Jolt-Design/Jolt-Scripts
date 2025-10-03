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

type UpdateDetails = {
  name: string
  title: string
  fromVersion: string
  toVersion: string
}

type UpdateResult = {
  updated: boolean
  details?: UpdateDetails
}

type UpdateSummary = {
  plugins: Array<UpdateDetails>
  themes: Array<UpdateDetails>
  core: { fromVersion: string; toVersion: string } | null
  translations: boolean
}

type ItemType = 'plugin' | 'theme'

type ItemDetails = PluginDetails | ThemeDetails

type ItemConfig = {
  type: ItemType
  icon: string
  listCommand: string[]
  updateCommand: (name: string) => string[]
  getFolder: (wpConfig: WordPressConfig) => string
  commitPrefix: string
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
  skipLanguages = Option.Boolean('--skip-languages', false, { description: 'Skip language/translation updates' })

  async command(): Promise<number | undefined> {
    const {
      config,
      context: { stdout, stderr },
      skipCore,
      skipPlugins,
      skipThemes,
      skipLanguages,
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

    // Track detailed update information for summary
    const updateSummary: UpdateSummary = {
      plugins: [],
      themes: [],
      core: null,
      translations: false,
    }

    // Get current status
    if (!skipPlugins) {
      await this.getItems<PluginDetails>('plugin')
    }

    if (!skipThemes) {
      await this.getItems<ThemeDetails>('theme')
    }

    // We'll create the update branch only when we need to make our first commit
    const branchRef = { branch: undefined as string | undefined, created: false }

    // Disable git hooks temporarily
    const originalHookPath = await this.disableGitHooks()

    try {
      // Update plugins
      const pluginUpdates = await this.processItemUpdates<PluginDetails>('plugin', skipPlugins, wpConfig, branchRef)
      updatedPluginCount = pluginUpdates.count
      updateSummary.plugins = pluginUpdates.details

      // Update themes
      const themeUpdates = await this.processItemUpdates<ThemeDetails>('theme', skipThemes, wpConfig, branchRef)
      updatedThemeCount = themeUpdates.count
      updateSummary.themes = themeUpdates.details

      // Update core
      if (!skipCore) {
        stdout.write(ansis.cyan('📦 Checking WordPress core...\n'))
        const coreResult = await this.maybeUpdateCore(wpConfig, branchRef)
        updatedCore = coreResult.updated
        if (coreResult.updated && coreResult.details) {
          updateSummary.core = coreResult.details
        }
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

    // Update translations if possible
    let updatedTranslations = false

    if (!skipLanguages && (totalUpdates > 0 || !branchRef.created)) {
      stdout.write(ansis.cyan('🌐 Updating translations...\n'))
      updatedTranslations = await this.maybeUpdateTranslations(branchRef)
      updateSummary.translations = updatedTranslations
    }

    // Show detailed update summary
    if (totalUpdates > 0 || updatedTranslations) {
      stdout.write(ansis.bold('\n📋 Update Summary:\n'))

      if (updateSummary.plugins.length > 0) {
        stdout.write(ansis.green('🔌 Plugins updated:\n'))
        for (const plugin of updateSummary.plugins) {
          stdout.write(ansis.cyan(`  • ${plugin.title} (${plugin.fromVersion} → ${plugin.toVersion})\n`))
        }
      }

      if (updateSummary.themes.length > 0) {
        stdout.write(ansis.green('🎨 Themes updated:\n'))
        for (const theme of updateSummary.themes) {
          stdout.write(ansis.cyan(`  • ${theme.title} (${theme.fromVersion} → ${theme.toVersion})\n`))
        }
      }

      if (updateSummary.core) {
        stdout.write(ansis.green('📦 WordPress core updated:\n'))
        stdout.write(
          ansis.cyan(`  • WordPress (${updateSummary.core.fromVersion} → ${updateSummary.core.toVersion})\n`),
        )
      }

      if (updateSummary.translations) {
        stdout.write(ansis.green('🌐 Translations updated\n'))
      }
    }

    if (totalUpdates > 0 && branchRef.created) {
      stdout.write(ansis.yellow('\nNext steps:\n'))
      stdout.write(`• Review updates: ${ansis.dim(await this.getUpdateCommand('modify'))}\n`)
      // Use root config value directly
      stdout.write(`• Merge to ${await config.get('branch')}: ${ansis.dim(await this.getUpdateCommand('merge'))}\n`)
    } else if (totalUpdates === 0 && !updatedTranslations) {
      stdout.write(ansis.green('\n✅ No updates available - staying on current branch\n'))
    }

    return 0
  }

  // Helper method to get the appropriate command format (short or long form)
  private async getUpdateCommand(subCommand: string): Promise<string> {
    const { config } = this
    const yarnCommand = await config.command('yarn')
    const packageJson = await config.getPackageJson()

    // Check if there's an 'update' script that acts as a shortcut for 'jolt wp update'
    const updateScript = packageJson?.scripts?.update
    if (updateScript && (updateScript === 'jolt wp update' || updateScript.startsWith('jolt wp update '))) {
      return `${yarnCommand} update ${subCommand}`
    }

    // Fall back to the full command
    return `${yarnCommand} jolt wp update ${subCommand}`
  }

  // Helper method to execute WP CLI commands
  private async executeWpCli(
    args: string[],
    options?: { reject?: boolean; silent?: boolean },
  ): Promise<{ exitCode: number; stdout: string | null }> {
    const { config, context } = this
    const yarnCommand = await config.command('yarn')

    // For silent operations, don't pass context to suppress output
    const execOptions = {
      reject: false,
      ...options,
      ...(!options?.silent ? { context } : {}),
    }

    const result = await execC(yarnCommand, ['jolt', 'wp', 'cli', ...args], execOptions)

    return {
      exitCode: result.exitCode || 0,
      stdout: result.exitCode === 0 ? String(result.stdout || '') : null,
    }
  }

  // Configuration for different item types
  private getItemConfig(type: ItemType): ItemConfig {
    const configs: Record<ItemType, ItemConfig> = {
      plugin: {
        type: 'plugin',
        icon: '🔌',
        listCommand: ['plugin', 'list', '--json'],
        updateCommand: (name: string) => ['plugin', 'update', name],
        getFolder: (wpConfig: WordPressConfig) => wpConfig.pluginFolder,
        commitPrefix: 'Update',
      },
      theme: {
        type: 'theme',
        icon: '🎨',
        listCommand: ['theme', 'list', '--json'],
        updateCommand: (name: string) => ['theme', 'update', name],
        getFolder: (wpConfig: WordPressConfig) => wpConfig.themeFolder,
        commitPrefix: 'Update theme',
      },
    }
    return configs[type]
  }

  // Generic method to get and parse item lists
  private async getItems<T extends ItemDetails>(type: ItemType): Promise<T[]> {
    const {
      context: { stdout },
    } = this
    const itemConfig = this.getItemConfig(type)

    stdout.write(ansis.cyan(`${itemConfig.icon} Checking ${type}s...\n`))
    const result = await this.executeWpCli(itemConfig.listCommand, { silent: true })

    if (!result.stdout) {
      return []
    }

    const items = this.parseItemJson<T>(result.stdout)
    stdout.write(`Found ${items.length} ${type}s\n`)
    return items
  }

  // Generic method to parse item JSON (plugins/themes have same structure)
  private parseItemJson<T extends ItemDetails>(itemJson: string): T[] {
    // Trim off any preceding warnings, try to look for the start of the actual JSON.
    const trimmed = itemJson.substring(itemJson.indexOf('[{'))
    const allItems = JSON.parse(trimmed)

    // For plugins, filter out dropin and must-use plugins
    return allItems.filter((item: ItemDetails) => !['dropin', 'must-use'].includes(item.status))
  }

  // Generic method to handle updating items
  private async processItemUpdates<T extends ItemDetails>(
    type: ItemType,
    skip: boolean,
    wpConfig: WordPressConfig,
    branchRef: { branch?: string; created: boolean },
  ): Promise<{ count: number; details: UpdateDetails[] }> {
    if (skip) {
      return { count: 0, details: [] }
    }

    const itemConfig = this.getItemConfig(type)
    const items = await this.getItems<T>(type)
    const updateDetails: UpdateDetails[] = []
    let count = 0

    if (items.length > 0) {
      this.context.stdout.write(ansis.cyan(`${itemConfig.icon} Updating ${type}s...\n`))

      for (const item of items) {
        const result = await this.maybeUpdateItem(item, wpConfig, branchRef, itemConfig)
        if (result.updated) {
          count++
          if (result.details) {
            updateDetails.push(result.details)
          }
        }
      }
    }

    return { count, details: updateDetails }
  }

  // Generic method to check and maybe update an item (plugin/theme)
  private async maybeUpdateItem<T extends ItemDetails>(
    item: T,
    wpConfig: WordPressConfig,
    branchRef: { branch?: string; created: boolean },
    itemConfig: ItemConfig,
  ): Promise<UpdateResult> {
    const {
      context: { stdout },
    } = this

    if (wpConfig.doNotUpdate.includes(item.name)) {
      stdout.write(ansis.dim(`  Skipping ${item.name} (configured to skip)\n`))
      return { updated: false }
    }

    stdout.write(`  Checking ${item.name}...`)

    if (item.update === 'available') {
      stdout.write(ansis.green(' updating\n'))
      return await this.updateItem(item, wpConfig, branchRef, itemConfig)
    }

    if (item.update === 'none') {
      stdout.write(ansis.dim(' up to date\n'))
    } else if (item.update === 'version higher than expected') {
      stdout.write(ansis.yellow(` local version ${item.version} is higher than remote\n`))
    } else {
      stdout.write(ansis.red(` unknown status: ${item.update}\n`))
    }

    return { updated: false }
  }

  // Generic method to update an item (plugin/theme)
  private async updateItem<T extends ItemDetails>(
    item: T,
    wpConfig: WordPressConfig,
    branchRef: { branch?: string; created: boolean },
    itemConfig: ItemConfig,
  ): Promise<UpdateResult> {
    const {
      config,
      context: { stdout, stderr },
    } = this

    try {
      const gitCommand = await config.command('git')
      const details = await this.getDetails(item.name, itemConfig.type)
      if (!details) {
        return { updated: false }
      }

      const fromVersion = details.version
      const prettyTitle = this.cleanTitle(details.title)
      const location = `${itemConfig.getFolder(wpConfig)}/${item.name}`

      const updateResult = await this.executeWpCli(itemConfig.updateCommand(item.name), { silent: true })

      if (updateResult.exitCode !== 0) {
        stderr.write(ansis.red(`    Error updating ${item.name}\n`))
        return { updated: false }
      }

      const newDetails = await this.getDetails(item.name, itemConfig.type)
      if (!newDetails || newDetails.version === details.version) {
        stderr.write(ansis.red('    Update failed!\n'))
        return { updated: false }
      }

      // Ensure branch is created before making our first commit
      await this.ensureBranchCreated(wpConfig, branchRef)

      const commitMessage = this.sanitizeCommitMessage(
        `${itemConfig.commitPrefix} ${prettyTitle} to ${newDetails.version}`,
      )

      await execC(gitCommand, ['add', location])
      await execC(gitCommand, ['commit', '-m', commitMessage], {
        shell: false,
        env: { SKIP: 'prepare-commit-msg' },
      })

      stdout.write(ansis.green(`    Updated ${prettyTitle} from ${fromVersion} to ${newDetails.version}\n`))
      return {
        updated: true,
        details: {
          name: item.name,
          title: prettyTitle,
          fromVersion,
          toVersion: newDetails.version,
        },
      }
    } catch (error) {
      stderr.write(ansis.red(`    Error updating ${item.name}: ${error}\n`))
      return { updated: false }
    }
  }

  private async createBranch(): Promise<string> {
    const { config } = this
    const isoDate = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '_').slice(0, -5)
    const branchName = `joltWpUpdate/${isoDate}`

    const gitCommand = await config.command('git')
    await execC(gitCommand, ['checkout', '-b', branchName])
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

  private async getDetails(name: string, type: 'plugin' | 'theme'): Promise<PluginDetails | ThemeDetails | null> {
    try {
      const result = await this.executeWpCli([type, 'get', '--json', name], { silent: true })

      if (!result.stdout) {
        return null
      }

      let output = result.stdout

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
  ): Promise<{ updated: boolean; details?: { fromVersion: string; toVersion: string } }> {
    const {
      context: { stdout },
    } = this

    const newVersion = await this.hasCoreUpdate()

    if (!newVersion) {
      stdout.write(ansis.dim('  WordPress core is up to date\n'))
      return { updated: false }
    }

    // Get current version before updating
    const currentVersion = await this.getCurrentCoreVersion()

    stdout.write(ansis.green(`  Updating WordPress core to ${newVersion}\n`))

    const shouldStash = await this.hasGitChanges(wpConfig.wpRoot)

    if (shouldStash) {
      stdout.write(ansis.yellow('    Stashing changes temporarily...\n'))
      await this.stashChanges()
    }

    try {
      await this.doCoreUpdate(wpConfig.wpRoot, newVersion, wpConfig, branchRef)
      stdout.write(ansis.green(`    Updated WordPress core to ${newVersion}\n`))
      return {
        updated: true,
        details: {
          fromVersion: currentVersion || 'unknown',
          toVersion: newVersion,
        },
      }
    } finally {
      if (shouldStash) {
        stdout.write(ansis.yellow('    Restoring stashed changes...\n'))
        await this.unstashChanges()
      }
    }
  }

  private async getCurrentCoreVersion(): Promise<string | null> {
    try {
      const result = await this.executeWpCli(['core', 'version'], { silent: true })
      return result.stdout ? result.stdout.trim() : null
    } catch {
      return null
    }
  }

  private async hasCoreUpdate(): Promise<string | false> {
    try {
      const result = await this.executeWpCli(['core', 'check-update', '--json'], { silent: true })

      if (!result.stdout || !result.stdout.trim() || result.stdout.trim() === '[]') {
        return false
      }

      const trimmed = result.stdout.substring(result.stdout.indexOf('[{'))
      const parsed = JSON.parse(trimmed)

      return parsed[0]?.version || false
    } catch {
      return false
    }
  }

  private async hasGitChanges(path: string): Promise<boolean> {
    const { config } = this

    try {
      const gitCommand = await config.command('git')
      const result = await execC(gitCommand, ['status', '--porcelain=v1', '--', path], {
        reject: false,
      })
      return String(result.stdout || '').trim() !== ''
    } catch {
      return false
    }
  }

  private async stashChanges(): Promise<void> {
    const { config } = this
    const date = new Date().toISOString()

    const gitCommand = await config.command('git')
    await execC(gitCommand, ['add', '.'])
    await execC(gitCommand, ['stash', 'save', '--', `Automated stash by Jolt WP Updater at ${date}`], {
      shell: false,
    })
  }

  private async unstashChanges(): Promise<void> {
    const { config } = this

    const gitCommand = await config.command('git')
    await execC(gitCommand, ['stash', 'pop'])
    await execC(gitCommand, ['reset', 'HEAD', '--'])
  }

  private async doCoreUpdate(
    path: string,
    version: string,
    wpConfig: WordPressConfig,
    branchRef: { branch?: string; created: boolean },
  ): Promise<void> {
    const { config } = this

    // Ensure branch is created before making our first commit
    await this.ensureBranchCreated(wpConfig, branchRef)

    const gitCommand = await config.command('git')
    await this.executeWpCli(['core', 'update'], { silent: true })
    await execC(gitCommand, ['add', path])

    const commitMessage = this.sanitizeCommitMessage(`Update WordPress to ${version}`)
    await execC(gitCommand, ['commit', '-m', commitMessage], {
      shell: false,
      env: { SKIP: 'prepare-commit-msg' },
    })
  }

  private async maybeUpdateTranslations(branchRef: { branch?: string; created: boolean }): Promise<boolean> {
    const {
      config,
      context: { stdout, stderr },
    } = this

    try {
      let hasUpdates = false

      // Helper to check and update translations for a specific type
      const updateTranslationType = async (type: string, command: string[]) => {
        stdout.write(`  Checking ${type} translations...`)
        const result = await this.executeWpCli(command, { silent: true })

        if (result.exitCode === 0 && result.stdout) {
          if (result.stdout.includes('Updated') || result.stdout.includes('updated')) {
            hasUpdates = true
            stdout.write(ansis.green(' updated\n'))
          } else {
            stdout.write(ansis.dim(' up to date\n'))
          }
        } else {
          stdout.write(ansis.dim(' skipped (not available)\n'))
        }
      }

      // Update different translation types
      await updateTranslationType('core', ['language', 'core', 'update'])
      await updateTranslationType('plugin', ['language', 'plugin', 'update', '--all'])
      await updateTranslationType('theme', ['language', 'theme', 'update', '--all'])

      // If we have translation updates, commit them
      if (hasUpdates) {
        const wpConfig = await config.loadWordPressConfig()

        if (!wpConfig) {
          stderr.write(ansis.red('Failed to load WordPress configuration\n'))
          return false
        }

        // Create or ensure we're on the update branch
        await this.ensureBranchCreated(wpConfig, branchRef)

        const gitCommand = await config.command('git')

        // Add all language files that might have been updated
        await execC(gitCommand, ['add', wpConfig.wpRoot])

        // Check if there are any changes to commit
        const statusResult = await execC(gitCommand, ['diff', '--cached', '--exit-code'], {
          reject: false,
        })

        if (statusResult.exitCode !== 0) {
          // There are changes to commit
          await execC(gitCommand, ['commit', '-m', 'Update translations'], {
            shell: false,
            env: { SKIP: 'prepare-commit-msg' },
          })

          stdout.write(ansis.green('    Committed translation updates\n'))
          return true
        }

        stdout.write(ansis.dim('    No translation files changed\n'))
      }

      return false
    } catch (error) {
      stderr.write(ansis.red(`Error updating translations: ${error}\n`))
      return false
    }
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
