import { readdir } from 'node:fs/promises'
import ansis from 'ansis'
import { Option } from 'clipanion'
import * as t from 'typanion'
import getConfig from '../Config.js'
import { ConfigValidationError } from '../errors.js'
import { directoryExists, execC } from '../utils.js'
import JoltCommand from './JoltCommand.js'

async function shouldPrepareHusky(): Promise<boolean> {
  return await directoryExists('.husky')
}

async function shouldPrepareTofu(): Promise<boolean> {
  const files = await readdir('.')
  return Boolean(files.find((x) => x.match(/\.(tf|tofu)$/)))
}

async function shouldPrepareDbSeeds(): Promise<boolean> {
  const config = await getConfig()
  const packageJson = await config.getPackageJson()
  return Boolean(packageJson?.scripts?.['download-db-seeds'])
}

async function shouldPrepareDevPlugins(): Promise<boolean> {
  const config = await getConfig()
  const devPlugins = config.get('devPlugins')

  if (!devPlugins) {
    return false
  }

  const packageJson = await config.getPackageJson()
  const hasWpCommand = Boolean(packageJson?.scripts?.wp)
  return hasWpCommand
}

export class PrepareCommand extends JoltCommand {
  static paths = [['prepare']]

  devPlugins = Option.Boolean('--dev-plugins', true)
  husky = Option.Boolean('--husky', true)
  tofu = Option.Boolean('--tofu', true)
  dbSeeds = Option.Boolean('--download-db-seeds', true)

  pluginDelay = Option.String('--plugin-delay', {
    required: false,
    validator: t.cascade(t.isNumber(), [t.isInteger(), t.isPositive()]),
  })

  async runPrepareCommands(timing: PrepareTimingOption): Promise<number> {
    const {
      config,
      cli,
      context,
      context: { stderr, stdout },
    } = this

    const indent = '  '
    let additionalCommands: PrepareCommandConfig[]

    try {
      additionalCommands = config.getPrepareCommands(timing)
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        stderr.write(ansis.red(`${error.message}\n`))
        return 1
      }

      throw error
    }

    if (additionalCommands.length > 0) {
      for (const command of additionalCommands) {
        const name = command.name || command.cmd

        stdout.write(ansis.white(`${indent}➕ Running command from config: ${ansis.blue(name)}...\n`))

        const cwdArgs = command.dir ? ['--cwd', command.dir] : []
        const args = ['cmd', ...cwdArgs, command.cmd]
        const retval = await cli.run(args, context)

        if (command.fail && retval > 0) {
          stderr.write(ansis.red(`Error running prepare step ${name}: Returned code ${retval}\n`))
          return retval
        }
      }
    }

    return 0
  }

  async command(): Promise<number | undefined> {
    const {
      cli,
      config,
      context,
      context: { stdout },
      dbSeeds,
      devPlugins,
      husky,
      pluginDelay,
      tofu,
    } = this

    const indent = '  '

    stdout.write(ansis.blue.bold('📋 Preparing repo...\n'))

    const earlyExitCode = await this.runPrepareCommands('early')

    if (earlyExitCode > 0) {
      return earlyExitCode
    }

    if (husky && (await shouldPrepareHusky())) {
      stdout.write(ansis.white(`${indent}🐕 Preparing Husky hooks... `))
      // TODO: Check if husky is installed in the repo and use yarn if so
      await execC(await config.command('npx'), ['--yes', '--prefer-offline', 'husky'])
      stdout.write(ansis.green('OK\n'))
    }

    if (tofu && (await shouldPrepareTofu())) {
      stdout.write(ansis.white(`${indent}🌍 Preparing Terraform variables... `))
      const tofuCmd = await config.command('tofu')
      await execC(tofuCmd, ['init'])
      await execC(tofuCmd, ['refresh'])
      stdout.write(ansis.green('OK\n'))
    }

    if (dbSeeds && (await shouldPrepareDbSeeds())) {
      stdout.write(ansis.white(`${indent}🛢️  Downloading DB seeds... `))
      const yarn = await config.command('yarn')
      await execC(yarn, ['run', 'download-db-seeds'])
      stdout.write(ansis.green('OK\n'))
    }

    if (await shouldPrepareDevPlugins()) {
      if (devPlugins) {
        stdout.write(ansis.white(`${indent}🐳 Starting Compose stack...\n`))
        const [compose, args] = await config.getComposeCommand()
        await execC(compose, [...args, 'up', '--build', '-d'], { context })

        const delaySeconds = pluginDelay && pluginDelay > 0 ? pluginDelay : await config.getDevPluginDelay()
        stdout.write(ansis.white(`${indent}🕘 Waiting up to ${delaySeconds} seconds for DB to populate... `))
        await cli.run(['db', 'await', `--timeout=${delaySeconds}`, '--quiet'], context)
        stdout.write(ansis.green('OK\n'))

        stdout.write(ansis.white(`${indent}🔌 Activating dev plugins... `))
        const yarn = await config.command('yarn')
        await execC(yarn, ['run', 'wp', 'plugin', 'activate', await config.get('devPlugins')])
        stdout.write(ansis.green('OK\n'))
      } else {
        stdout.write(ansis.white(`${indent}🔌 Skipping dev plugins... ${ansis.yellow('SKIPPED')}\n`))
      }
    }

    const normalExitCode = await this.runPrepareCommands('normal')

    if (normalExitCode > 0) {
      return normalExitCode
    }

    stdout.write(ansis.blue.bold('\n📋 Repo prepared.\n'))
    return 0
  }
}
