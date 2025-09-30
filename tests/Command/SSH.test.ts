import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { RsyncCommand, SSHCommand } from '../../src/Command/SSH.js'
import { Config } from '../../src/Config.js'
import { execC } from '../../src/utils.js'

vi.mock('../../src/utils.js')
vi.mock('../../src/Config.js')

describe('SSH Commands', () => {
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

    vi.spyOn(mockConfig, 'command').mockImplementation((cmd: string) => {
      return Promise.resolve(cmd)
    })

    vi.spyOn(mockConfig, 'get').mockImplementation((key: string) => {
      switch (key) {
        case 'sshAccount':
          return Promise.resolve('user@prod.example.com')
        case 'devSshAccount':
          return Promise.resolve('user@dev.example.com')
        case 'sshPort':
          return Promise.resolve('22')
        case 'liveFolder':
          return Promise.resolve('/var/www/html')
        case 'devFolder':
          return Promise.resolve('/var/www/dev')
        default:
          return Promise.resolve(undefined)
      }
    })
    vi.spyOn(mockConfig, 'parseArg').mockImplementation((value: string, params?: any) => {
      if (params) {
        let result = value
        if (result.includes('{acc}')) {
          result = result.replace(/\{acc\}/g, params.acc)
        }
        if (result.includes('{contentFolder}')) {
          result = result.replace(/\{contentFolder\}/g, params.contentFolder)
        }
        return Promise.resolve(result)
      }
      return Promise.resolve(value)
    })

    // Mock execC
    vi.mocked(execC).mockResolvedValue({ exitCode: 0 } as any)
  })

  describe('SSHCommand', () => {
    let command: SSHCommand

    beforeEach(() => {
      command = new SSHCommand()
      command.config = mockConfig
      // @ts-expect-error - Mocking context for testing
      command.context = mockContext
      command.dev = false
      command.args = []
    })

    describe('getRequiredConfig', () => {
      it('should require sshAccount for production', () => {
        command.dev = false
        expect(command.getRequiredConfig()).toEqual(['sshAccount'])
      })

      it('should require devSshAccount for dev', () => {
        command.dev = true
        expect(command.getRequiredConfig()).toEqual(['devSshAccount'])
      })
    })

    describe('command execution', () => {
      it('should execute ssh with production account by default', async () => {
        command.args = ['-t', 'ls -la']

        const result = await command.command()

        expect(mockConfig.command).toHaveBeenCalledWith('ssh')
        expect(mockConfig.get).toHaveBeenCalledWith('sshAccount')
        expect(execC).toHaveBeenCalledWith(
          'ssh',
          ['user@prod.example.com', '-t', 'ls -la'],
          expect.objectContaining({
            context: mockContext,
          }),
        )
        expect(result).toBe(0)
      })

      it('should execute ssh with dev account when --dev flag is used', async () => {
        command.dev = true
        command.args = ['-t', 'ls -la']

        const result = await command.command()

        expect(mockConfig.get).toHaveBeenCalledWith('devSshAccount')
        expect(execC).toHaveBeenCalledWith(
          'ssh',
          ['user@dev.example.com', '-t', 'ls -la'],
          expect.objectContaining({
            context: mockContext,
          }),
        )
        expect(result).toBe(0)
      })

      it('should pass through all arguments', async () => {
        command.args = ['-t', '-o', 'StrictHostKeyChecking=no', 'whoami']

        await command.command()

        expect(execC).toHaveBeenCalledWith(
          'ssh',
          ['user@prod.example.com', '-t', '-o', 'StrictHostKeyChecking=no', 'whoami'],
          expect.objectContaining({
            context: mockContext,
          }),
        )
      })

      it('should parse arguments with config templating', async () => {
        command.args = ['-t', 'echo {config:testVar}']
        vi.spyOn(mockConfig, 'parseArg').mockImplementation((value: string) =>
          Promise.resolve(value === 'echo {config:testVar}' ? 'echo parsed-value' : value),
        )

        await command.command()

        expect(mockConfig.parseArg).toHaveBeenCalledWith('-t')
        expect(mockConfig.parseArg).toHaveBeenCalledWith('echo {config:testVar}')
        expect(execC).toHaveBeenCalledWith(
          'ssh',
          ['user@prod.example.com', '-t', 'echo parsed-value'],
          expect.objectContaining({
            context: mockContext,
          }),
        )
      })

      it('should return the exit code from execC', async () => {
        vi.mocked(execC).mockResolvedValue({ exitCode: 1 } as any)

        const result = await command.command()

        expect(result).toBe(1)
      })

      it('should handle empty arguments', async () => {
        command.args = []

        await command.command()

        expect(execC).toHaveBeenCalledWith(
          'ssh',
          ['user@prod.example.com'],
          expect.objectContaining({
            context: mockContext,
          }),
        )
      })
    })
  })

  describe('RsyncCommand', () => {
    let command: RsyncCommand

    beforeEach(() => {
      command = new RsyncCommand()
      command.config = mockConfig
      // @ts-expect-error - Mocking context for testing
      command.context = mockContext
      command.dev = false
      command.dryRun = false
      command.args = []
    })

    describe('getRequiredConfig', () => {
      it('should require sshAccount for production', () => {
        command.dev = false
        expect(command.getRequiredConfig()).toEqual(['sshAccount'])
      })

      it('should require devSshAccount for dev', () => {
        command.dev = true
        expect(command.getRequiredConfig()).toEqual(['devSshAccount'])
      })
    })

    describe('command execution', () => {
      it('should execute rsync with production settings by default', async () => {
        command.args = ['./local/', '{acc}:{contentFolder}/']

        const result = await command.command()

        expect(mockConfig.command).toHaveBeenCalledWith('ssh')
        expect(mockConfig.command).toHaveBeenCalledWith('rsync')
        expect(mockConfig.get).toHaveBeenCalledWith('sshAccount')
        expect(mockConfig.get).toHaveBeenCalledWith('sshPort')
        expect(mockConfig.get).toHaveBeenCalledWith('liveFolder')
        expect(execC).toHaveBeenCalledWith(
          'rsync',
          ['--rsh="ssh -p22"', '-av', '', './local/', 'user@prod.example.com:/var/www/html/'],
          expect.objectContaining({
            context: mockContext,
          }),
        )
        expect(result).toBe(0)
      })

      it('should execute rsync with dev settings when --dev flag is used', async () => {
        command.dev = true
        command.args = ['./local/', '{acc}:{contentFolder}/']

        await command.command()

        expect(mockConfig.get).toHaveBeenCalledWith('devSshAccount')
        expect(mockConfig.get).toHaveBeenCalledWith('devFolder')
        expect(execC).toHaveBeenCalledWith(
          'rsync',
          ['--rsh="ssh -p22"', '-av', '', './local/', 'user@dev.example.com:/var/www/dev/'],
          expect.objectContaining({
            context: mockContext,
          }),
        )
      })

      it('should add --dry-run flag when dryRun is true', async () => {
        command.dryRun = true
        command.args = ['./local/', '{acc}:{contentFolder}/']

        await command.command()

        expect(execC).toHaveBeenCalledWith(
          'rsync',
          ['--rsh="ssh -p22"', '-av', '--dry-run', './local/', 'user@prod.example.com:/var/www/html/'],
          expect.objectContaining({
            context: mockContext,
          }),
        )
      })

      it('should use custom SSH port when configured', async () => {
        vi.spyOn(mockConfig, 'get').mockImplementation((key: string) => {
          switch (key) {
            case 'sshAccount':
              return Promise.resolve('user@prod.example.com')
            case 'sshPort':
              return Promise.resolve('2222')
            case 'liveFolder':
              return Promise.resolve('/var/www/html')
            default:
              return Promise.resolve(undefined)
          }
        })
        command.args = ['./local/', '{acc}:{contentFolder}/']

        await command.command()

        expect(execC).toHaveBeenCalledWith(
          'rsync',
          ['--rsh="ssh -p2222"', '-av', '', './local/', 'user@prod.example.com:/var/www/html/'],
          expect.objectContaining({
            context: mockContext,
          }),
        )
      })

      it('should default to port 22 when sshPort is not configured', async () => {
        vi.spyOn(mockConfig, 'get').mockImplementation((key: string) => {
          switch (key) {
            case 'sshAccount':
              return Promise.resolve('user@prod.example.com')
            case 'sshPort':
              return Promise.resolve(undefined)
            case 'liveFolder':
              return Promise.resolve('/var/www/html')
            default:
              return Promise.resolve(undefined)
          }
        })
        command.args = ['./local/', '{acc}:{contentFolder}/']

        await command.command()

        expect(execC).toHaveBeenCalledWith(
          'rsync',
          ['--rsh="ssh -p22"', '-av', '', './local/', 'user@prod.example.com:/var/www/html/'],
          expect.objectContaining({
            context: mockContext,
          }),
        )
      })

      it('should handle empty contentFolder gracefully', async () => {
        vi.spyOn(mockConfig, 'get').mockImplementation((key: string) => {
          switch (key) {
            case 'sshAccount':
              return Promise.resolve('user@prod.example.com')
            case 'sshPort':
              return Promise.resolve('22')
            case 'liveFolder':
              return Promise.resolve(undefined)
            default:
              return Promise.resolve(undefined)
          }
        })
        command.args = ['./local/', '{acc}:{contentFolder}/']

        await command.command()

        expect(execC).toHaveBeenCalledWith(
          'rsync',
          ['--rsh="ssh -p22"', '-av', '', './local/', 'user@prod.example.com:/'],
          expect.objectContaining({
            context: mockContext,
          }),
        )
      })

      it('should display the command being run', async () => {
        command.args = ['./local/', '{acc}:{contentFolder}/']

        await command.command()

        expect(mockStdout.write).toHaveBeenCalledWith(
          expect.stringContaining(
            'Running command: rsync --rsh="ssh -p22" -av  ./local/ user@prod.example.com:/var/www/html/',
          ),
        )
      })

      it('should parse arguments with parameters', async () => {
        command.args = ['./local/', '{acc}:{contentFolder}/remote/']

        await command.command()

        expect(mockConfig.parseArg).toHaveBeenCalledWith('./local/', {
          acc: 'user@prod.example.com',
          contentFolder: '/var/www/html',
        })
        expect(mockConfig.parseArg).toHaveBeenCalledWith('{acc}:{contentFolder}/remote/', {
          acc: 'user@prod.example.com',
          contentFolder: '/var/www/html',
        })
      })

      it('should return the exit code from execC', async () => {
        vi.mocked(execC).mockResolvedValue({ exitCode: 2 } as any)
        command.args = ['./local/', '{acc}:{contentFolder}/']

        const result = await command.command()

        expect(result).toBe(2)
      })

      it('should handle complex rsync arguments', async () => {
        command.args = ['--exclude=node_modules', '--exclude=.git', '--delete', './local/', '{acc}:{contentFolder}/']

        await command.command()

        expect(execC).toHaveBeenCalledWith(
          'rsync',
          [
            '--rsh="ssh -p22"',
            '-av',
            '',
            '--exclude=node_modules',
            '--exclude=.git',
            '--delete',
            './local/',
            'user@prod.example.com:/var/www/html/',
          ],
          expect.objectContaining({
            context: mockContext,
          }),
        )
      })

      it('should combine dry-run and dev flags correctly', async () => {
        command.dev = true
        command.dryRun = true
        command.args = ['./local/', '{acc}:{contentFolder}/']

        await command.command()

        expect(mockConfig.get).toHaveBeenCalledWith('devSshAccount')
        expect(mockConfig.get).toHaveBeenCalledWith('devFolder')
        expect(execC).toHaveBeenCalledWith(
          'rsync',
          ['--rsh="ssh -p22"', '-av', '--dry-run', './local/', 'user@dev.example.com:/var/www/dev/'],
          expect.objectContaining({
            context: mockContext,
          }),
        )
      })
    })
  })
})
