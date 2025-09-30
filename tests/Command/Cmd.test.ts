import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { CmdCommand } from '../../src/Command/Cmd.js'
import { Config } from '../../src/Config.js'
import { execC } from '../../src/utils.js'

vi.mock('../../src/utils.js')
vi.mock('../../src/Config.js')

describe('CmdCommand', () => {
  let command: CmdCommand
  let mockConfig: Config
  let mockStdout: { write: Mock }
  let mockStderr: { write: Mock }
  let mockContext: { stdin: any; stdout: any; stderr: any }

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock streams
    mockStdout = { write: vi.fn() }
    mockStderr = { write: vi.fn() }
    mockContext = {
      stdin: process.stdin,
      stdout: mockStdout,
      stderr: mockStderr,
    }

    // Create a mock config
    mockConfig = new Config({})
    vi.spyOn(mockConfig, 'parseArg').mockImplementation((value: string) => Promise.resolve(value))

    // Create command instance
    command = new CmdCommand()
    command.config = mockConfig
    // @ts-expect-error - Mocking context for testing
    command.context = mockContext
    command.cwd = undefined
    command.quiet = false
    command.args = []

    // Mock execC
    vi.mocked(execC).mockResolvedValue({ exitCode: 0 } as any)
  })

  describe('basic command execution', () => {
    it('should execute a simple command', async () => {
      command.args = ['echo', 'hello']

      const result = await command.command()

      expect(execC).toHaveBeenCalledWith(
        'echo',
        ['hello'],
        expect.objectContaining({
          cwd: undefined,
          context: mockContext,
          shell: true,
        }),
      )
      expect(result).toBe(0)
    })

    it('should display command being run when not quiet', async () => {
      command.args = ['ls', '-la']

      await command.command()

      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Running command: ls -la...'))
    })

    it('should not display command when quiet flag is in args', async () => {
      command.args = ['-q', 'ls', '-la']

      await command.command()

      expect(mockStdout.write).not.toHaveBeenCalled()
    })

    it('should return the exit code from execC', async () => {
      command.args = ['false'] // Command that exits with code 1
      vi.mocked(execC).mockResolvedValue({ exitCode: 1 } as any)

      const result = await command.command()

      expect(result).toBe(1)
    })
  })

  describe('argument parsing', () => {
    it('should handle config templating in arguments', async () => {
      command.args = ['echo', '{config:testVar}']
      vi.spyOn(mockConfig, 'parseArg').mockImplementation((value: string) =>
        Promise.resolve(value === '{config:testVar}' ? 'parsed-value' : value),
      )

      await command.command()

      expect(mockConfig.parseArg).toHaveBeenCalledWith('echo')
      expect(mockConfig.parseArg).toHaveBeenCalledWith('{config:testVar}')
      expect(execC).toHaveBeenCalledWith('echo', ['parsed-value'], expect.any(Object))
    })

    it('should parse all arguments through config.parseArg', async () => {
      command.args = ['cmd', 'arg1', 'arg2']

      await command.command()

      expect(mockConfig.parseArg).toHaveBeenCalledTimes(3)
      expect(mockConfig.parseArg).toHaveBeenCalledWith('cmd')
      expect(mockConfig.parseArg).toHaveBeenCalledWith('arg1')
      expect(mockConfig.parseArg).toHaveBeenCalledWith('arg2')
    })
  })

  describe('quiet flag parsing', () => {
    it('should parse -q flag and set quiet mode', async () => {
      command.args = ['-q', 'echo', 'hello']

      await command.command()

      expect(mockStdout.write).not.toHaveBeenCalled()
      expect(execC).toHaveBeenCalledWith('echo', ['hello'], expect.any(Object))
    })

    it('should parse --quiet flag and set quiet mode', async () => {
      command.args = ['--quiet', 'echo', 'hello']

      await command.command()

      expect(mockStdout.write).not.toHaveBeenCalled()
      expect(execC).toHaveBeenCalledWith('echo', ['hello'], expect.any(Object))
    })

    it('should handle multiple quiet flags', async () => {
      command.args = ['-q', '--quiet', 'echo', 'hello']

      await command.command()

      expect(mockStdout.write).not.toHaveBeenCalled()
      expect(execC).toHaveBeenCalledWith('echo', ['hello'], expect.any(Object))
    })
  })

  describe('cwd flag parsing', () => {
    it('should parse -c flag with separate argument', async () => {
      command.args = ['-c', '/tmp', 'echo', 'hello']

      await command.command()

      expect(execC).toHaveBeenCalledWith(
        'echo',
        ['hello'],
        expect.objectContaining({
          cwd: '/tmp',
          context: mockContext,
          shell: true,
        }),
      )
    })

    it('should parse --cwd flag with separate argument', async () => {
      command.args = ['--cwd', '/home/user', 'ls']

      await command.command()

      expect(execC).toHaveBeenCalledWith(
        'ls',
        [],
        expect.objectContaining({
          cwd: '/home/user',
        }),
      )
    })

    it('should parse --cwd=path format', async () => {
      command.args = ['--cwd=/var/log', 'tail', '-f', 'file.log']

      await command.command()

      expect(execC).toHaveBeenCalledWith(
        'tail',
        ['-f', 'file.log'],
        expect.objectContaining({
          cwd: '/var/log',
        }),
      )
    })

    it('should handle cwd with config templating using -c flag', async () => {
      command.args = ['-c', '{config:workDir}', 'pwd']
      vi.spyOn(mockConfig, 'parseArg').mockImplementation((value: string) =>
        Promise.resolve(value === '{config:workDir}' ? '/parsed/path' : value),
      )

      await command.command()

      expect(execC).toHaveBeenCalledWith(
        'pwd',
        [],
        expect.objectContaining({
          cwd: '/parsed/path',
        }),
      )
    })

    it('should handle cwd with config templating using --cwd=value format', async () => {
      command.args = ['--cwd={config:workDir}', 'pwd']
      vi.spyOn(mockConfig, 'parseArg').mockImplementation((value: string) =>
        Promise.resolve(value === '--cwd={config:workDir}' ? '--cwd=/parsed/path' : value),
      )

      await command.command()

      expect(execC).toHaveBeenCalledWith(
        'pwd',
        [],
        expect.objectContaining({
          cwd: '/parsed/path',
        }),
      )
    })
  })

  describe('complex argument combinations', () => {
    it('should handle quiet and cwd flags together', async () => {
      command.args = ['-q', '--cwd', '/tmp', 'echo', 'test']

      await command.command()

      expect(mockStdout.write).not.toHaveBeenCalled()
      expect(execC).toHaveBeenCalledWith(
        'echo',
        ['test'],
        expect.objectContaining({
          cwd: '/tmp',
        }),
      )
    })

    it('should handle cwd and quiet in different order', async () => {
      command.args = ['--cwd=/home', '-q', 'ls', '-la']

      await command.command()

      expect(mockStdout.write).not.toHaveBeenCalled()
      expect(execC).toHaveBeenCalledWith(
        'ls',
        ['-la'],
        expect.objectContaining({
          cwd: '/home',
        }),
      )
    })

    it('should parse multiple flags correctly', async () => {
      command.args = ['-c', '/var', '--quiet', '-c', '/tmp', 'pwd']

      await command.command()

      // Should use the last cwd value
      expect(execC).toHaveBeenCalledWith(
        'pwd',
        [],
        expect.objectContaining({
          cwd: '/tmp',
        }),
      )
      expect(mockStdout.write).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('should handle empty args array', async () => {
      command.args = []

      await command.command()

      expect(execC).toHaveBeenCalledWith(undefined, [], expect.any(Object))
    })

    it('should handle args with only flags', async () => {
      command.args = ['-q', '--cwd', '/tmp']

      await command.command()

      expect(execC).toHaveBeenCalledWith(
        undefined,
        [],
        expect.objectContaining({
          cwd: '/tmp',
        }),
      )
      expect(mockStdout.write).not.toHaveBeenCalled()
    })

    it('should handle command with no additional args', async () => {
      command.args = ['pwd']

      await command.command()

      expect(execC).toHaveBeenCalledWith('pwd', [], expect.any(Object))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Running command: pwd...'))
    })

    it('should handle commands that look like flags', async () => {
      command.args = ['echo', '--help']

      await command.command()

      expect(execC).toHaveBeenCalledWith('echo', ['--help'], expect.any(Object))
    })

    it('should handle cwd flag without value', async () => {
      command.args = ['--cwd']

      await command.command()

      // Should treat next arg (undefined) as cwd value
      expect(execC).toHaveBeenCalledWith(
        undefined,
        [],
        expect.objectContaining({
          cwd: undefined,
        }),
      )
    })
  })

  describe('error handling', () => {
    it('should propagate execC errors', async () => {
      const error = new Error('Command failed')
      vi.mocked(execC).mockRejectedValue(error)
      command.args = ['false']

      await expect(command.command()).rejects.toThrow('Command failed')
    })

    it('should handle config parsing errors', async () => {
      const error = new Error('Config parse error')
      vi.spyOn(mockConfig, 'parseArg').mockRejectedValue(error)
      command.args = ['echo', 'test']

      await expect(command.command()).rejects.toThrow('Config parse error')
    })
  })

  describe('static properties', () => {
    it('should have correct command paths', () => {
      expect(CmdCommand.paths).toEqual([['cmd']])
    })
  })
})
