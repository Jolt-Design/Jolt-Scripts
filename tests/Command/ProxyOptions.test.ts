import { Cli } from 'clipanion'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CmdCommand } from '../../src/Command/Cmd.js'
import { DockerBuildCommand } from '../../src/Command/Docker.js'
import { RsyncCommand, SSHCommand } from '../../src/Command/SSH.js'
import getConfig from '../../src/Config.js'
import { execC, which } from '../../src/utils.js'

vi.mock('../../src/utils.js')
vi.mock('../../src/Config.js')

const settings: Record<string, string> = {
  sshAccount: 'user@live.example.com',
  devSshAccount: 'user@dev.example.com',
}

const mockConfig = {
  command: vi.fn(async (name: string) => name),
  get: vi.fn(async (key: string) => settings[key]),
  parseArg: vi.fn(async (value: string) => value),
  redact: vi.fn((value: string) => value),
  setSite: vi.fn(),
}

async function run(args: string[]) {
  const cli = new Cli({ binaryName: 'jolt', binaryLabel: 'Jolt Scripts' })

  for (const command of [CmdCommand, DockerBuildCommand, RsyncCommand, SSHCommand]) {
    cli.register(command)
  }

  const chunks: string[] = []
  const write = (chunk: string) => {
    chunks.push(chunk)
    return true
  }
  const exitCode = await cli.run(args, { stdout: { write }, stderr: { write } } as never)

  return { exitCode, output: chunks.join('') }
}

describe('jolt options on pass-through commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(which).mockResolvedValue('/usr/bin/tool')
    vi.mocked(execC).mockResolvedValue({ exitCode: 0 } as never)
    vi.mocked(getConfig).mockResolvedValue(mockConfig as never)
  })

  it.each([
    [['ssh', '--dev', 'ls'], 'Put --dev before the command name, e.g. `jolt --dev ssh …`'],
    [['ssh', '--site=shop', 'ls'], 'Put --site before the command name'],
    [['rsync', '--dry-run', 'a/', 'b/'], 'Put --dry-run before the command name, e.g. `jolt --dry-run rsync …`'],
    [['docker', 'build', '--dev'], 'e.g. `jolt --dev docker build …`'],
    [['cmd', '--for-each-site', 'ls'], 'Put --for-each-site before the command name'],
  ])('rejects %j without running anything', async (args, message) => {
    const { exitCode, output } = await run(args)

    expect(exitCode).toBe(1)
    expect(output).toContain(message)
    expect(getConfig).not.toHaveBeenCalled()
    expect(execC).not.toHaveBeenCalled()
  })

  it('uses the dev account when --dev comes before the command name', async () => {
    const { exitCode } = await run(['--dev', 'ssh', 'ls', '-la'])

    expect(exitCode).toBe(0)
    expect(execC).toHaveBeenCalledWith('ssh', ['user@dev.example.com', 'ls', '-la'], expect.anything())
  })

  it.each([
    [
      ['ssh', '-s', 'sftp'],
      ['user@live.example.com', '-s', 'sftp'],
    ],
    [
      ['ssh', 'ls', '--dev'],
      ['user@live.example.com', 'ls', '--dev'],
    ],
    [
      ['ssh', '--', '--dev'],
      ['user@live.example.com', '--', '--dev'],
    ],
    [
      ['ssh', '--verbose'],
      ['user@live.example.com', '--verbose'],
    ],
  ])('passes %j to the wrapped tool', async (args, expected) => {
    const { exitCode } = await run(args)

    expect(exitCode).toBe(0)
    expect(execC).toHaveBeenCalledWith('ssh', expected, expect.anything())
  })

  it("still reads cmd's own options after the command name", async () => {
    const { exitCode } = await run(['cmd', '--quiet', 'echo', 'hi'])

    expect(exitCode).toBe(0)
    expect(execC).toHaveBeenCalledWith('echo', ['hi'], expect.objectContaining({ shell: true }))
  })
})
