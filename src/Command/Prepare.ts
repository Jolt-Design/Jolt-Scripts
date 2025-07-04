import { readdir } from 'node:fs/promises'
import ansis from 'ansis'
import { Option } from 'clipanion'
import getConfig from '../Config.js'
import { delay, directoryExists, execC } from '../utils.js'
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

  async command(): Promise<number | undefined> {
    const {
      cli,
      config,
      context,
      context: { stdout },
      devPlugins,
    } = this

    const indent = '  '

    stdout.write(ansis.blue.bold('📋 Preparing repo...\n'))

    if (await shouldPrepareHusky()) {
      stdout.write(ansis.white(`${indent}🐕 Preparing Husky hooks... `))
      // TODO: Check if husky is installed in the repo and use yarn if so
      await execC(await config.command('npx'), ['--yes', '--prefer-offline', 'husky'])
      stdout.write(ansis.green('OK\n'))
    }

    if (await shouldPrepareTofu()) {
      stdout.write(ansis.white(`${indent}🌍 Preparing Terraform variables... `))
      const tofu = await config.command('tofu')
      await execC(tofu, ['init'])
      await execC(tofu, ['refresh'])
      stdout.write(ansis.green('OK\n'))
    }

    if (await shouldPrepareDbSeeds()) {
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

        const delaySeconds = await config.getDevPluginDelay()
        stdout.write(ansis.white(`${indent}🕘 Waiting ${delaySeconds} seconds for DB to populate... `))
        await delay(1000 * delaySeconds)
        stdout.write(ansis.green('OK\n'))

        stdout.write(ansis.white(`${indent}🔌 Activating dev plugins... `))
        const yarn = await config.command('yarn')
        await execC(yarn, ['run', 'wp', 'plugin', 'activate', await config.get('devPlugins')])
        stdout.write(ansis.green('OK\n'))
      } else {
        stdout.write(ansis.white(`${indent}🔌 Skipping dev plugins... ${ansis.yellow('SKIPPED')}\n`))
      }
    }

    const additionalCommands = config.getPrepareCommands()

    if (additionalCommands.length > 0) {
      for (const command of additionalCommands) {
        const parsedCommand = await config.parseArg(command)
        stdout.write(ansis.white(`${indent}➕ Running command from config: ${ansis.blue(parsedCommand)}\n`))
        await cli.run(['cmd', '--quiet', command], context)
      }
    }

    stdout.write(ansis.blue.bold('\n📋 Repo prepared.\n'))
    return 0
  }
}
