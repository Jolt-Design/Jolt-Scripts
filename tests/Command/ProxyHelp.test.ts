import { Cli } from 'clipanion'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LogsTailCommand } from '../../src/Command/AWS.js'
import { CmdCommand } from '../../src/Command/Cmd.js'
import { DockerBuildCommand } from '../../src/Command/Docker.js'
import { RsyncCommand, SSHCommand } from '../../src/Command/SSH.js'
import { WPCLICommand } from '../../src/Command/WP.js'
import getConfig from '../../src/Config.js'
import { execC, which } from '../../src/utils.js'

vi.mock('../../src/utils.js')
vi.mock('../../src/Config.js')

async function run(args: string[]) {
  const cli = new Cli({ binaryName: 'jolt', binaryLabel: 'Jolt Scripts' })

  for (const command of [LogsTailCommand, CmdCommand, DockerBuildCommand, RsyncCommand, SSHCommand, WPCLICommand]) {
    cli.register(command)
  }

  const chunks: string[] = []
  const exitCode = await cli.run(args, {
    stdout: {
      write: (chunk: string) => {
        chunks.push(chunk)
        return true
      },
    },
    stderr: { write: () => true },
  } as never)

  return { exitCode, stdout: chunks.join('') }
}

describe('help on pass-through commands', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(which).mockResolvedValue('/usr/bin/tool')
    vi.mocked(execC).mockResolvedValue({ exitCode: 0 } as never)
    vi.mocked(getConfig).mockResolvedValue({
      command: async (name: string) => name,
      get: async () => 'user@live.example.com',
      parseArg: async (value: string) => value,
      setSite: () => undefined,
    } as never)
  })

  it.each([
    [['ssh', '--help'], 'jolt ssh'],
    [['ssh', '-h'], 'jolt ssh'],
    [['rsync', '--help'], 'jolt rsync'],
    [['rsync', '-h'], 'jolt rsync'],
    [['cmd', '--help'], 'jolt cmd'],
    [['docker', 'build', '--help'], 'jolt docker build'],
    [['wp', 'cli', '--help'], 'jolt wp cli'],
    [['aws', 'logs', 'tail', '/ecs/site', '--help'], 'jolt aws logs tail'],
  ])('%j prints jolt usage without running the wrapped tool', async (args, expected) => {
    const { exitCode, stdout } = await run(args)

    expect(exitCode).toBe(0)
    expect(stdout).toContain(expected)
    expect(getConfig).not.toHaveBeenCalled()
    expect(execC).not.toHaveBeenCalled()
  })

  it('passes --help to the wrapped tool after a -- separator', async () => {
    const { exitCode } = await run(['ssh', '--', '--help'])

    expect(exitCode).toBe(0)
    expect(execC).toHaveBeenCalledWith('ssh', ['user@live.example.com', '--', '--help'], expect.anything())
  })

  it('passes --help to the wrapped tool when it is not the first argument', async () => {
    const { exitCode } = await run(['ssh', 'ls', '--help'])

    expect(exitCode).toBe(0)
    expect(execC).toHaveBeenCalledWith('ssh', ['user@live.example.com', 'ls', '--help'], expect.anything())
  })
})
