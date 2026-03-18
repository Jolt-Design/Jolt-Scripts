import { AsyncLocalStorage } from 'node:async_hooks'
import ansis from 'ansis'
import { Command, Option } from 'clipanion'
import * as t from 'typanion'
import type { Config } from '../Config.js'
import getConfig, { getSiteConfig } from '../Config.js'
import { which } from '../utils.js'

// Per-execution async context for config to support parallel site execution
const configContext = new AsyncLocalStorage<Config>()

export default abstract class JoltCommand extends Command {
  logo = ansis.magentaBright('⚡')
  private _config!: Config
  requiredCommands: string[] = []
  requiredConfig: string[] = []
  site = Option.String('-s,--site', { required: false, description: 'Target site configuration to use' })

  forEachSite = Option.String('-x,--for-each-site', false, {
    tolerateBoolean: true,
    description:
      'Run command for each configured site. Specify "series" or "parallel" to change the run type. Defaults to series.',
    validator: t.isEnum([false, 'series', 'parallel']),
  })

  static schema = [t.hasMutuallyExclusiveKeys(['site', 'forEachSite'], { missingIf: 'falsy' })]

  abstract command(): Promise<number | undefined>

  /**
   * Get the effective config, checking async context first (for parallel execution)
   */
  get config(): Config {
    const contextConfig = configContext.getStore()
    return contextConfig ?? this._config
  }

  /**
   * Set the config (typically used during initial setup or single-threaded execution)
   */
  set config(value: Config) {
    this._config = value
  }

  /**
   * Override this method to provide dynamic config requirements based on command options
   */
  getRequiredConfig(): string[] {
    return this.requiredConfig
  }
  private async validateRequiredConfig(): Promise<number | undefined> {
    if (process.env.JOLT_IGNORE_REQUIRED_CONFIG) {
      return undefined
    }

    const { stderr } = this.context
    const requiredConfigKeys = this.getRequiredConfig()

    if (!requiredConfigKeys || requiredConfigKeys.length === 0) {
      return undefined
    }

    const missingConfig = []

    for (const configKey of requiredConfigKeys) {
      const configValue = await this.config.get(configKey)

      if (!configValue) {
        missingConfig.push(configKey)
      }
    }

    if (missingConfig.length > 0) {
      stderr.write(this.getHeader())
      stderr.write(ansis.red('Missing the following required config entries:\n'))

      for (const missingConfigKey of missingConfig) {
        stderr.write(ansis.red(`- ${missingConfigKey}\n`))
      }

      stderr.write('\n\nSee `jolt config` for more information.\n')
      return 5
    }

    return undefined
  }

  getHeader(suffix = '') {
    const header = ansis.whiteBright(`${this.logo} ${this.cli.binaryLabel}`)
    return [header, suffix, '\n\n'].filter((x) => !!x).join(' ')
  }

  async execute(): Promise<number | undefined> {
    const { stderr } = this.context
    const config = await getConfig()
    this.config = config

    if (this.forEachSite) {
      const mode = this.getForEachSiteMode(this.forEachSite)

      if (!mode) {
        throw new Error(`Invalid for each mode: ${mode}`)
      }

      return await this.executeForAllSites(mode)
    }

    if (this.site) {
      config.setSite(this.site)
    }

    if (this.requiredCommands && !process.env.JOLT_IGNORE_REQUIRED_COMMANDS) {
      // Parallelize command resolution and validation
      const commandChecks = await Promise.all(
        this.requiredCommands.map(async (baseCommand) => {
          const realCommand = await config.command(baseCommand)
          const isAvailable = await which(realCommand)
          return { baseCommand, realCommand, isAvailable }
        }),
      )

      const missingCommands = commandChecks
        .filter(({ isAvailable }) => !isAvailable)
        .map(({ realCommand }) => realCommand)

      if (missingCommands.length > 0) {
        stderr.write(this.getHeader())
        stderr.write(ansis.red('Missing the following commands:\n'))

        for (const missingCommand of missingCommands) {
          stderr.write(ansis.red(`- ${missingCommand}\n`))
        }

        stderr.write('\n\nSee `jolt config` for more information.\n')
        return 4
      }
    }

    // Config validation will happen in the command wrapper after options are parsed
    return await this.runCommandWithValidation()
  }

  private getForEachSiteMode(forEachSite: string | boolean): 'series' | 'parallel' | false {
    if (forEachSite === true) {
      return 'series'
    }

    if (forEachSite === false) {
      return false
    }

    const lower = forEachSite.toLowerCase()

    if (lower === 'series') {
      return 'series'
    }

    if (lower === 'parallel') {
      return 'parallel'
    }

    return false
  }

  private async executeForAllSites(forEachSiteMode: string): Promise<number | undefined> {
    const sites = this.config.getSites()
    const siteNames = Object.keys(sites)

    if (siteNames.length === 0) {
      return 0
    }

    // Check for required commands once before running for all sites
    if (this.requiredCommands && !process.env.JOLT_IGNORE_REQUIRED_COMMANDS) {
      const commandChecks = await Promise.all(
        this.requiredCommands.map(async (baseCommand) => {
          const realCommand = await this.config.command(baseCommand)
          const isAvailable = await which(realCommand)

          return { baseCommand, realCommand, isAvailable }
        }),
      )

      const missingCommands = commandChecks
        .filter(({ isAvailable }) => !isAvailable)
        .map(({ realCommand }) => realCommand)

      if (missingCommands.length > 0) {
        const { stderr } = this.context
        stderr.write(this.getHeader())
        stderr.write(ansis.red('Missing the following commands:\n'))

        for (const missingCommand of missingCommands) {
          stderr.write(ansis.red(`- ${missingCommand}\n`))
        }

        return 4
      }
    }

    // Run all sites in parallel
    if (forEachSiteMode === 'parallel') {
      const promises = siteNames.map((siteName) => this.executeForSite(siteName))
      const exitCodes = await Promise.all(promises)
      const failedResult = exitCodes.find((code) => code !== 0 && code !== undefined)

      return failedResult ?? 0
    }

    // Run sites in series (default)
    for (const siteName of siteNames) {
      const exitCode = await this.executeForSite(siteName)

      if (exitCode !== 0 && exitCode !== undefined) {
        return exitCode
      }
    }

    return 0
  }

  private async executeForSite(siteName: string): Promise<number | undefined> {
    // Get a site-specific cached config instance
    // Each site gets its own Config instance, but they are cached and reused
    const siteConfig = await getSiteConfig(siteName)

    // Run this site's execution within its own async context
    // This prevents race conditions when multiple sites execute in parallel
    return await configContext.run(siteConfig, async () => {
      // Validate required config for this site
      const configValidationResult = await this.validateRequiredConfig()

      if (configValidationResult !== undefined) {
        return configValidationResult
      }

      return await this.command()
    })
  }

  private async runCommandWithValidation(): Promise<number | undefined> {
    // Validate required config after options are parsed
    const configValidationResult = await this.validateRequiredConfig()

    if (configValidationResult !== undefined) {
      return configValidationResult
    }

    return await this.command()
  }
}
