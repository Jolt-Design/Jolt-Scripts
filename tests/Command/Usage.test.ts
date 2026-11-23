import { Builtins, Cli, type CommandClass } from 'clipanion'
import { describe, expect, it } from 'vitest'
import * as AWS from '../../src/Command/AWS.js'
import * as Build from '../../src/Command/Build.js'
import * as Cache from '../../src/Command/Cache.js'
import * as Cmd from '../../src/Command/Cmd.js'
import * as ConfigCommands from '../../src/Command/Config.js'
import * as DB from '../../src/Command/DB.js'
import * as Docker from '../../src/Command/Docker.js'
import * as Nexcess from '../../src/Command/Nexcess.js'
import * as Prepare from '../../src/Command/Prepare.js'
import * as Reference from '../../src/Command/Reference.js'
import * as SSH from '../../src/Command/SSH.js'
import * as Template from '../../src/Command/Template.js'
import * as WP from '../../src/Command/WP.js'

const modules = [AWS, Build, Cache, Cmd, ConfigCommands, DB, Docker, Nexcess, Prepare, Reference, SSH, Template, WP]

const commandClasses = modules
  .flatMap((module) => Object.values(module))
  .filter((value): value is CommandClass => typeof value === 'function' && 'paths' in value)

describe('command usage', () => {
  it('finds the command classes', () => {
    expect(commandClasses.length).toBeGreaterThan(30)
  })

  it.each(commandClasses.map((commandClass) => [commandClass.name, commandClass] as const))(
    '%s has a usage description and category',
    (_name, commandClass) => {
      expect(commandClass.usage?.description, 'usage description').toBeTruthy()
      expect(commandClass.usage?.category, 'usage category').toBeTruthy()
    },
  )
})

describe('built-in commands', () => {
  async function run(args: string[]) {
    const cli = new Cli({ binaryName: 'jolt', binaryLabel: 'Jolt Scripts', binaryVersion: '1.2.3' })
    cli.register(Builtins.HelpCommand)
    cli.register(Builtins.VersionCommand)
    cli.register(Reference.ReferenceCommand)
    cli.register(Build.BuildCommand)

    const chunks: string[] = []
    const exitCode = await cli.run(args, {
      stdout: {
        write: (chunk: string) => {
          chunks.push(chunk)
          return true
        },
      },
    } as never)

    return { exitCode, stdout: chunks.join('') }
  }

  it('prints the command list for --help', async () => {
    const { exitCode, stdout } = await run(['--help'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('jolt build')
  })

  it('prints the version for --version', async () => {
    const { exitCode, stdout } = await run(['--version'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('1.2.3')
  })

  it('prints every command and the shared concepts for reference', async () => {
    const { exitCode, stdout } = await run(['reference'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('jolt build')
    expect(stdout).toContain('EXIT CODES')
  })
})
