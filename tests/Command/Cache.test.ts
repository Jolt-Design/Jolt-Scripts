import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CacheFlushCommand } from '../../src/Command/Cache.js'
import type { Config } from '../../src/Config.js'
import { execC } from '../../src/utils.js'

vi.mock('../../src/utils.js', () => ({
  execC: vi.fn(),
  which: vi.fn(),
}))

describe('CacheFlushCommand', () => {
  let command: CacheFlushCommand
  let mockConfig: {
    getComposeCommand: ReturnType<typeof vi.fn>
    getCacheContainerInfo: ReturnType<typeof vi.fn>
  }
  let mockStderr: { write: ReturnType<typeof vi.fn> }
  let mockStdout: { write: ReturnType<typeof vi.fn> }
  let mockContext: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup stream mocks
    mockStderr = { write: vi.fn() }
    mockStdout = { write: vi.fn() }
    mockContext = {
      stderr: mockStderr,
      stdout: mockStdout,
    }

    // Create mock config
    mockConfig = {
      getComposeCommand: vi.fn(),
      getCacheContainerInfo: vi.fn(),
    }

    // Create command instance
    command = new CacheFlushCommand()
    command.config = mockConfig as Config
    command.context = mockContext

    // Mock execC to return successful result
    vi.mocked(execC).mockResolvedValue({ exitCode: 0 } as any)
  })

  describe('command paths', () => {
    it('should register correct command paths', () => {
      expect(CacheFlushCommand.paths).toEqual([
        ['cache', 'flush'],
        ['cache', 'clean'],
        ['cache', 'clear'],
      ])
    })
  })

  describe('required commands', () => {
    it('should require docker and compose commands', () => {
      expect(command.requiredCommands).toEqual(['docker', 'compose'])
    })
  })

  describe('command execution', () => {
    it('should successfully flush Redis cache', async () => {
      // Setup mocks
      mockConfig.getComposeCommand.mockResolvedValue(['docker', ['compose']])
      mockConfig.getCacheContainerInfo.mockResolvedValue({
        name: 'redis',
        type: 'redis',
        cliCommand: 'redis-cli',
        service: { image: 'redis:7' },
      })

      // Execute command
      const result = await command.command()

      // Verify behavior
      expect(mockConfig.getComposeCommand).toHaveBeenCalledOnce()
      expect(mockConfig.getCacheContainerInfo).toHaveBeenCalledOnce()
      expect(mockStdout.write).toHaveBeenCalledWith(
        expect.stringContaining("🗃️ Clearing cache in container 'redis' using the redis-cli command."),
      )
      expect(execC).toHaveBeenCalledWith('docker', ['compose', 'exec', 'redis', 'redis-cli', 'flushall'], {
        context: mockContext,
      })
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('🗃️ Cache cleared.'))
      expect(result).toBe(0)
    })

    it('should successfully flush Valkey cache', async () => {
      // Setup mocks
      mockConfig.getComposeCommand.mockResolvedValue(['docker', ['compose']])
      mockConfig.getCacheContainerInfo.mockResolvedValue({
        name: 'valkey',
        type: 'valkey',
        cliCommand: 'valkey-cli',
        service: { image: 'valkey/valkey:7' },
      })

      // Execute command
      const result = await command.command()

      // Verify behavior
      expect(mockConfig.getComposeCommand).toHaveBeenCalledOnce()
      expect(mockConfig.getCacheContainerInfo).toHaveBeenCalledOnce()
      expect(mockStdout.write).toHaveBeenCalledWith(
        expect.stringContaining("🗃️ Clearing cache in container 'valkey' using the valkey-cli command."),
      )
      expect(execC).toHaveBeenCalledWith('docker', ['compose', 'exec', 'valkey', 'valkey-cli', 'flushall'], {
        context: mockContext,
      })
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('🗃️ Cache cleared.'))
      expect(result).toBe(0)
    })

    it('should handle custom container names', async () => {
      // Setup mocks
      mockConfig.getComposeCommand.mockResolvedValue(['docker', ['compose']])
      mockConfig.getCacheContainerInfo.mockResolvedValue({
        name: 'my-custom-redis',
        type: 'redis',
        cliCommand: 'redis-cli',
        service: { image: 'redis:alpine' },
      })

      // Execute command
      const result = await command.command()

      // Verify behavior
      expect(execC).toHaveBeenCalledWith('docker', ['compose', 'exec', 'my-custom-redis', 'redis-cli', 'flushall'], {
        context: mockContext,
      })
      expect(result).toBe(0)
    })

    it('should handle different compose commands', async () => {
      // Setup mocks - using docker-compose instead of docker compose
      mockConfig.getComposeCommand.mockResolvedValue(['docker-compose', []])
      mockConfig.getCacheContainerInfo.mockResolvedValue({
        name: 'redis',
        type: 'redis',
        cliCommand: 'redis-cli',
        service: { image: 'redis:7' },
      })

      // Execute command
      const result = await command.command()

      // Verify behavior
      expect(execC).toHaveBeenCalledWith('docker-compose', ['exec', 'redis', 'redis-cli', 'flushall'], {
        context: mockContext,
      })
      expect(result).toBe(0)
    })

    it('should return error code when no cache container is found', async () => {
      // Setup mocks
      mockConfig.getComposeCommand.mockResolvedValue(['docker', ['compose']])
      mockConfig.getCacheContainerInfo.mockResolvedValue(undefined)

      // Execute command
      const result = await command.command()

      // Verify behavior
      expect(mockConfig.getComposeCommand).toHaveBeenCalledOnce()
      expect(mockConfig.getCacheContainerInfo).toHaveBeenCalledOnce()
      expect(mockStderr.write).toHaveBeenCalledWith(
        expect.stringContaining("🗃️ Couldn't find a configured cache container."),
      )
      expect(execC).not.toHaveBeenCalled()
      expect(result).toBe(1)
    })

    it('should return execC exit code on execution failure', async () => {
      // Setup mocks
      mockConfig.getComposeCommand.mockResolvedValue(['docker', ['compose']])
      mockConfig.getCacheContainerInfo.mockResolvedValue({
        name: 'redis',
        type: 'redis',
        cliCommand: 'redis-cli',
        service: { image: 'redis:7' },
      })
      vi.mocked(execC).mockResolvedValue({ exitCode: 127 } as any)

      // Execute command
      const result = await command.command()

      // Verify behavior
      expect(execC).toHaveBeenCalledWith('docker', ['compose', 'exec', 'redis', 'redis-cli', 'flushall'], {
        context: mockContext,
      })
      expect(result).toBe(127)
    })

    it('should handle execC throwing an error', async () => {
      // Setup mocks
      mockConfig.getComposeCommand.mockResolvedValue(['docker', ['compose']])
      mockConfig.getCacheContainerInfo.mockResolvedValue({
        name: 'redis',
        type: 'redis',
        cliCommand: 'redis-cli',
        service: { image: 'redis:7' },
      })
      const error = new Error('Docker command failed')
      vi.mocked(execC).mockRejectedValue(error)

      // Execute command and expect it to throw
      await expect(command.command()).rejects.toThrow('Docker command failed')

      // Verify execC was called
      expect(execC).toHaveBeenCalledWith('docker', ['compose', 'exec', 'redis', 'redis-cli', 'flushall'], {
        context: mockContext,
      })
    })
  })

  describe('compose command integration', () => {
    it('should handle compose command with additional arguments', async () => {
      // Setup mocks - compose command with project name
      mockConfig.getComposeCommand.mockResolvedValue(['docker', ['compose', '-p', 'myproject']])
      mockConfig.getCacheContainerInfo.mockResolvedValue({
        name: 'redis',
        type: 'redis',
        cliCommand: 'redis-cli',
        service: { image: 'redis:7' },
      })

      // Execute command
      const result = await command.command()

      // Verify behavior
      expect(execC).toHaveBeenCalledWith(
        'docker',
        ['compose', '-p', 'myproject', 'exec', 'redis', 'redis-cli', 'flushall'],
        { context: mockContext },
      )
      expect(result).toBe(0)
    })

    it('should handle podman-compose', async () => {
      // Setup mocks - using podman-compose
      mockConfig.getComposeCommand.mockResolvedValue(['podman-compose', []])
      mockConfig.getCacheContainerInfo.mockResolvedValue({
        name: 'redis',
        type: 'redis',
        cliCommand: 'redis-cli',
        service: { image: 'redis:7' },
      })

      // Execute command
      const result = await command.command()

      // Verify behavior
      expect(execC).toHaveBeenCalledWith('podman-compose', ['exec', 'redis', 'redis-cli', 'flushall'], {
        context: mockContext,
      })
      expect(result).toBe(0)
    })
  })

  describe('output formatting', () => {
    it('should include emoji and color formatting in output messages', async () => {
      // Setup mocks
      mockConfig.getComposeCommand.mockResolvedValue(['docker', ['compose']])
      mockConfig.getCacheContainerInfo.mockResolvedValue({
        name: 'redis',
        type: 'redis',
        cliCommand: 'redis-cli',
        service: { image: 'redis:7' },
      })

      // Execute command
      await command.command()

      // Verify output includes emojis and contains expected text
      const stdoutCalls = mockStdout.write.mock.calls
      expect(stdoutCalls).toHaveLength(2)
      expect(stdoutCalls[0][0]).toMatch(/🗃️.*Clearing cache in container 'redis'/)
      expect(stdoutCalls[1][0]).toMatch(/🗃️.*Cache cleared/)
    })

    it('should include emoji in error message', async () => {
      // Setup mocks
      mockConfig.getComposeCommand.mockResolvedValue(['docker', ['compose']])
      mockConfig.getCacheContainerInfo.mockResolvedValue(undefined)

      // Execute command
      await command.command()

      // Verify error output includes emoji
      const stderrCalls = mockStderr.write.mock.calls
      expect(stderrCalls).toHaveLength(1)
      expect(stderrCalls[0][0]).toMatch(/🗃️.*Couldn't find a configured cache container/)
    })
  })
})
