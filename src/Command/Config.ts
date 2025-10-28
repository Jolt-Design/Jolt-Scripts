import { access, readFile, writeFile } from 'node:fs/promises'
import ansis from 'ansis'
import { Option } from 'clipanion'
import * as t from 'typanion'
import { execC, which } from '../utils.js'
import JoltCommand from './JoltCommand.js'

enum ConfigCommandFormat {
  Pretty = 'pretty',
  Json = 'json',
  Env = 'env',
}

export class ConfigCommand extends JoltCommand {
  static paths = [['config']]

  format: ConfigCommandFormat | undefined = Option.String('--format', {
    required: false,
    validator: t.isEnum(ConfigCommandFormat),
    description: 'Output format for configuration values',
  })

  commands = ['aws', 'compose', 'docker', 'git', 'gzip', 'node', 'rsync', 'ssh', 'tofu', 'yarn']

  async command(): Promise<number | undefined> {
    const {
      config,
      format,
      context: { stderr, stdout },
    } = this

    if (format === undefined || format === ConfigCommandFormat.Pretty) {
      stdout.write(ansis.bold.whiteBright(this.getHeader('Config')))

      await this.listCommands()
      stdout.write('\n')
      await this.listConfig()
      return 0
    }

    if (format === ConfigCommandFormat.Json) {
      stdout.write(`${config.asJson()}\n`)
      return 0
    }

    if (format === ConfigCommandFormat.Env) {
      const envVars = config.asEnvVars()
      const varsString = Object.entries(envVars)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
      stdout.write(`${varsString}\n`)
      return 0
    }

    stderr.write(ansis.red(`Unknown format "${format}"\n`))
    return 1
  }

  async listCommands() {
    const {
      config,
      commands,
      context: { stdout },
    } = this

    stdout.write(ansis.bold.blue('Commands:\n'))

    // Parallelize command override and which checks
    const commandInfos = await Promise.all(
      commands.map(async (commandName) => {
        const { command, source, sourceType } = await config.getCommandOverride(commandName)
        const isAvailable = await which(command)
        return { commandName, command, source, sourceType, isAvailable }
      }),
    )

    for (const { commandName, command, source, sourceType, isAvailable } of commandInfos) {
      stdout.write(ansis.bold(`${commandName}: `))

      if (isAvailable) {
        stdout.write(ansis.green(command))
      } else {
        stdout.write(ansis.red(`${command} ${ansis.bold('[Missing!]')}`))
      }

      let sourceString = ''

      switch (sourceType) {
        case 'env':
          sourceString = `[Env var: ${source}]`
          break
        case 'config':
          sourceString = `[Config: ${source}]`
          break
      }

      if (sourceString) {
        stdout.write(` ${ansis.gray(sourceString)}`)
      }

      stdout.write('\n')
    }
  }

  async listConfig() {
    const {
      config,
      context: { stdout },
    } = this

    const sourceString = config.configPath ? ansis.dim(`[Source file: ${config.configPath}]`) : ''
    stdout.write(ansis.bold.blue(`Config: ${sourceString}\n`))

    for (const [key, value] of config) {
      stdout.write(ansis.bold(`${key}: `))

      if (typeof value === 'string') {
        const parsedValue = await config.parseArg(value)
        stdout.write(parsedValue)

        if (parsedValue !== value) {
          stdout.write(ansis.dim(` [Parsed from: ${value}]`))
        }
      } else if (Array.isArray(value)) {
        const parsedEntries = await Promise.all(value.map((x) => config.parseArg(typeof x === 'string' ? x : x.cmd)))
        const outputs: string[] = []

        for (const [i, entry] of parsedEntries.entries()) {
          let line = `  ${entry}`
          const compare = typeof value[i] === 'string' ? value[i] : value[i].cmd

          if (entry !== compare) {
            line += ansis.dim(` [Parsed from: ${compare}]`)
          }

          outputs.push(line)
        }

        const output = parsedEntries.length ? `[\n${outputs.join('\n')}\n]` : '[]'
        stdout.write(output)
      } else {
        stdout.write(`Unsupported type: ${JSON.stringify(value)}`)
      }

      stdout.write('\n')
    }
  }
}

export class ConfigInitCommand extends JoltCommand {
  static paths = [['config', 'init']]

  requiredCommands: string[] = []

  async command(): Promise<number | undefined> {
    const {
      config,
      context: { stdout },
    } = this

    const configPath = '.jolt.json'
    let configData: Record<string, unknown> = {}
    let existingFile = false
    let existingContent: string | undefined

    // Check if .jolt.json already exists
    try {
      existingContent = await readFile(configPath, 'utf-8')
      configData = JSON.parse(existingContent)
      existingFile = true
      stdout.write(ansis.yellow('⚠️  .jolt.json already exists\n'))
    } catch (_error) {
      // File doesn't exist or is invalid JSON, create new one
      stdout.write(ansis.green('📄 Creating new .jolt.json file\n'))
    }

    // Determine the best schema reference to use
    // For shared config files, use online reference to ensure cross-environment compatibility
    let schemaReference = 'https://raw.githubusercontent.com/Jolt-Design/jolt-scripts/master/jolt-config.schema.json'
    let schemaSource = 'online'

    // Only use local schema in development when explicitly available
    try {
      await access('./jolt-config.schema.json')
      schemaReference = './jolt-config.schema.json'
      schemaSource = 'local development'
    } catch {
      // Use online schema for production/shared environments
      // This ensures the config works across different environments without local dependencies
    }

    // Create new config object with $schema at the top
    const newConfigData: Record<string, unknown> = {
      $schema: schemaReference,
    }

    // Add existing config data (preserving order for existing files)
    Object.assign(newConfigData, configData)

    // If it's a new file, add some common example properties
    if (!existingFile) {
      // Auto-populate git repo from origin remote if available
      try {
        const gitCommand = await config.command('git')

        if (gitCommand) {
          const remoteResult = await execC(gitCommand, ['remote', 'get-url', 'origin'], {
            shell: false,
            reject: false,
          })

          if (!remoteResult.failed && remoteResult.stdout) {
            const remoteUrl = remoteResult.stdout.toString().trim()

            // Convert HTTPS to SSH format if needed
            if (remoteUrl.startsWith('https://github.com/')) {
              const match = remoteUrl.match(/https:\/\/github\.com\/(.+)\.git$/)

              if (match) {
                newConfigData.repo = `git@github.com:${match[1]}.git`
              }
            } else if (remoteUrl.startsWith('git@')) {
              newConfigData.repo = remoteUrl
            }
          }
        }
      } catch {
        // Ignore git errors, just skip auto-population
      }

      // Auto-populate database container info if available
      try {
        const dbInfo = await config.getDBContainerInfo()

        if (dbInfo) {
          newConfigData.dbContainer = dbInfo.name

          if (dbInfo.credentials.db) {
            newConfigData.dbName = dbInfo.credentials.db
          }

          if (dbInfo.credentials.user) {
            newConfigData.dbUser = dbInfo.credentials.user
          }

          if (dbInfo.credentials.pass) {
            newConfigData.dbPass = dbInfo.credentials.pass
          }
        }
      } catch {
        // Ignore database detection errors, just skip auto-population
      }

      // Auto-populate compose project name if available
      try {
        const composeConfig = await config.getComposeConfig()

        if (composeConfig?.name) {
          newConfigData.composeProject = composeConfig.name
        }
      } catch {
        // Ignore compose config detection errors, just skip auto-population
      }

      // Auto-populate branch name with default branch
      try {
        const gitCommand = await config.command('git')

        if (gitCommand) {
          // Get the default branch name (usually main or master)
          const defaultBranchResult = await execC(gitCommand, ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
            shell: false,
            reject: false,
          })

          if (!defaultBranchResult.failed && defaultBranchResult.stdout) {
            const defaultBranch = defaultBranchResult.stdout.toString().trim().replace('refs/remotes/origin/', '')
            newConfigData.branch = defaultBranch
          } else {
            // Fallback: try to get current branch name
            const currentBranchResult = await execC(gitCommand, ['branch', '--show-current'], {
              shell: false,
              reject: false,
            })

            if (!currentBranchResult.failed && currentBranchResult.stdout) {
              const currentBranch = currentBranchResult.stdout.toString().trim()
              newConfigData.branch = currentBranch
            }
          }
        }
      } catch {
        // Ignore git errors, just skip auto-population
      }
    }

    configData = newConfigData

    // Preserve existing indentation style or use 2 spaces for new files
    let indent: string | number = 2

    if (existingFile && existingContent) {
      // Detect existing indentation by looking for the first indented line
      const lines = existingContent.split('\n')

      for (const line of lines) {
        const match = line.match(/^(\s+)/)

        if (match) {
          indent = match[1].includes('\t') ? '\t' : match[1].length
          break
        }
      }
    }

    // Write the file
    await writeFile(configPath, `${JSON.stringify(configData, null, indent)}\n`)

    if (existingFile) {
      stdout.write(ansis.green('✅ Updated .jolt.json with schema reference\n'))
    } else {
      stdout.write(ansis.green('✅ Created .jolt.json with example configuration\n'))
    }

    stdout.write(ansis.dim(`Schema reference: ${schemaReference} (${schemaSource})\n`))
    stdout.write(ansis.dim('You can now edit .jolt.json with full IDE autocompletion support!\n'))

    return 0
  }
}

export class ConfigSitesCommand extends JoltCommand {
  static paths = [['config', 'sites']]

  format = Option.String('-f,--format', {
    required: false,
    validator: t.isEnum(['json', 'spaces', 'lines']),
  })

  async command(): Promise<number | undefined> {
    const {
      config,
      context: { stdout },
      format,
    } = this

    const sites = config.getSites()
    const siteKeys = Object.keys(sites)

    switch (format) {
      case 'spaces':
        stdout.write(`${siteKeys.join(' ')}\n`)
        break
      case 'lines':
        stdout.write(`${siteKeys.join('\n')}\n`)
        break
      default:
        stdout.write(`${JSON.stringify(siteKeys)}\n`)
        break
    }

    return 0
  }
}
