import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { BuildCommand } from '../../src/Command/Build.js'
import { Config } from '../../src/Config.js'

vi.mock('../../src/utils.js')

describe('BuildCommand', () => {
  let command: BuildCommand
  let mockConfig: Config
  let mockContext: {
    stdout: { write: Mock }
    stderr: { write: Mock }
    stdin: any
    env: any
    colorDepth: number
  }
  let mockCli: { run: Mock; usage: Mock }

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock context
    mockContext = {
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
      stdin: {},
      env: {},
      colorDepth: 1,
    }

    // Create mock CLI
    mockCli = {
      run: vi.fn().mockResolvedValue(0),
      usage: vi.fn().mockReturnValue('usage info'),
    }

    // Create command instance
    command = new BuildCommand()
    command.context = mockContext as any
    command.cli = mockCli as any
    command.dev = false
  })

  describe('with configured image name', () => {
    beforeEach(() => {
      mockConfig = new Config({ imageName: 'test-image' })
      vi.spyOn(mockConfig, 'get').mockResolvedValue('test-image')
      command.config = mockConfig
    })

    it('should delegate to docker build command in production mode', async () => {
      command.dev = false

      const result = await command.command()

      expect(mockContext.stdout.write).toHaveBeenCalledWith(
        expect.stringContaining('Found a configured image name (test-image) - assuming you wanted to build Docker.'),
      )
      expect(mockCli.run).toHaveBeenCalledWith(['build', 'docker', ''], mockContext)
      expect(result).toBe(0)
    })

    it('should delegate to docker build command in dev mode', async () => {
      command.dev = true

      const result = await command.command()

      expect(mockContext.stdout.write).toHaveBeenCalledWith(
        expect.stringContaining('Found a configured image name (test-image) - assuming you wanted to build Docker.'),
      )
      expect(mockCli.run).toHaveBeenCalledWith(['build', 'docker', '--dev'], mockContext)
      expect(result).toBe(0)
    })

    it('should return the result from the docker build command', async () => {
      mockCli.run.mockResolvedValue(42)

      const result = await command.command()

      expect(result).toBe(42)
    })
  })

  describe('without configured image name', () => {
    beforeEach(() => {
      mockConfig = new Config({})
      vi.spyOn(mockConfig, 'get').mockResolvedValue(undefined)
      command.config = mockConfig
    })

    it('should show usage and return error code', async () => {
      const result = await command.command()

      expect(mockContext.stderr.write).toHaveBeenCalledWith('usage info')
      expect(mockCli.usage).toHaveBeenCalled()
      expect(mockCli.run).not.toHaveBeenCalled()
      expect(result).toBe(1)
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      mockConfig = new Config({ imageName: 'test-image' })
      vi.spyOn(mockConfig, 'get').mockResolvedValue('test-image')
      command.config = mockConfig
    })

    it('should propagate errors from docker build command', async () => {
      const error = new Error('Docker build failed')
      mockCli.run.mockRejectedValue(error)

      await expect(command.command()).rejects.toThrow('Docker build failed')
    })
  })
})
