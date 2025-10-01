import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { DockerBuildCommand } from '../../src/Command/Docker.js'
import { Config } from '../../src/Config.js'
import * as utils from '../../src/utils.js'

vi.mock('../../src/utils.js', () => ({
  execC: vi.fn(),
  fileExists: vi.fn(),
  which: vi.fn(),
}))

describe('DockerBuildCommand', () => {
  let command: DockerBuildCommand
  let mockConfig: Config

  beforeEach(() => {
    vi.clearAllMocks()

    // Create a mock config
    mockConfig = new Config({ imageName: 'test-image' })

    // Mock the parseArg method
    vi.spyOn(mockConfig, 'parseArg').mockImplementation((value: string) => Promise.resolve(value))

    // Create command instance
    command = new DockerBuildCommand()
    command.config = mockConfig
    command.dev = false
    command.buildArgs = []
    command.provenance = true
  })

  describe('buildCommandArgs', () => {
    it('should use auto-detected Dockerfile when available', async () => {
      // Mock Dockerfile exists
      vi.spyOn(mockConfig, 'getDockerfilePath').mockResolvedValue('Dockerfile')

      const args = await command.buildCommandArgs()

      expect(args).toContain('-f Dockerfile')
      expect(args).toContain('-t test-image')
    })

    it('should use auto-detected Containerfile when Dockerfile does not exist', async () => {
      // Mock only Containerfile exists
      vi.spyOn(mockConfig, 'getDockerfilePath').mockResolvedValue('Containerfile')

      const args = await command.buildCommandArgs()

      expect(args).toContain('-f Containerfile')
      expect(args).toContain('-t test-image')
    })

    it('should use configured dockerFile over auto-detection', async () => {
      // Mock explicit config
      vi.spyOn(mockConfig, 'getDockerfilePath').mockResolvedValue('custom.dockerfile')

      const args = await command.buildCommandArgs()

      expect(args).toContain('-f custom.dockerfile')
      expect(args).toContain('-t test-image')
    })

    it('should not include -f flag when no dockerfile is found', async () => {
      // Mock no dockerfile found
      vi.spyOn(mockConfig, 'getDockerfilePath').mockResolvedValue(undefined)

      const args = await command.buildCommandArgs()

      expect(args).not.toContain(expect.stringContaining('-f'))
      expect(args).toContain('-t test-image')
    })

    it('should include dev build arg when dev flag is true', async () => {
      command.dev = true
      vi.spyOn(mockConfig, 'getDockerfilePath').mockResolvedValue('Dockerfile')
      vi.spyOn(mockConfig, 'getDockerImageName').mockResolvedValue('test-image-dev')

      const args = await command.buildCommandArgs()

      expect(args).toContain('--build-arg=DEVBUILD=1')
      expect(args).toContain('-t test-image-dev')
    })

    it('should include custom build args', async () => {
      command.buildArgs = ['ARG1=value1', 'ARG2=value2']
      vi.spyOn(mockConfig, 'getDockerfilePath').mockResolvedValue('Dockerfile')

      const args = await command.buildCommandArgs()

      expect(args).toContain('--build-arg=ARG1=value1')
      expect(args).toContain('--build-arg=ARG2=value2')
    })

    it('should include platform when configured', async () => {
      vi.spyOn(mockConfig, 'get').mockImplementation((key: string) => {
        if (key === 'buildPlatform') {
          return Promise.resolve('linux/amd64,linux/arm64')
        }

        return Promise.resolve(undefined)
      })
      vi.spyOn(mockConfig, 'getDockerfilePath').mockResolvedValue('Dockerfile')

      const args = await command.buildCommandArgs()

      expect(args).toContain('--platform=linux/amd64,linux/arm64')
    })

    it('should disable provenance when provenance flag is false', async () => {
      command.provenance = false
      vi.spyOn(mockConfig, 'getDockerfilePath').mockResolvedValue('Dockerfile')

      const args = await command.buildCommandArgs()

      expect(args).toContain('--provenance=false')
    })

    it('should use custom build context when configured', async () => {
      vi.spyOn(mockConfig, 'get').mockImplementation((key: string) => {
        if (key === 'buildContext') {
          return Promise.resolve('./custom-context')
        }

        return Promise.resolve(undefined)
      })
      vi.spyOn(mockConfig, 'getDockerfilePath').mockResolvedValue('Dockerfile')

      const args = await command.buildCommandArgs()

      expect(args).toContain('./custom-context')
    })
  })

  describe('command execution', () => {
    let execCMock: Mock
    let whichMock: Mock

    beforeEach(() => {
      const mockedUtils = vi.mocked(utils)
      execCMock = mockedUtils.execC as Mock
      whichMock = mockedUtils.which as Mock

      execCMock.mockResolvedValue({ exitCode: 0 })
      whichMock.mockResolvedValue(true)

      vi.spyOn(mockConfig, 'getDockerImageName').mockResolvedValue('test-image')
      vi.spyOn(mockConfig, 'command').mockResolvedValue('docker')
      vi.spyOn(mockConfig, 'getDockerfilePath').mockResolvedValue('Dockerfile')

      command.context = {
        stdout: { write: vi.fn() },
        stderr: { write: vi.fn() },
      } as any
    })

    it('should execute docker build command successfully', async () => {
      const result = await command.command()

      expect(execCMock).toHaveBeenCalledWith('docker', expect.arrayContaining(['buildx', 'build', '-t test-image']), {
        context: command.context,
      })
      expect(result).toBe(0)
    })

    it('should return error when image name is not configured', async () => {
      vi.spyOn(mockConfig, 'getDockerImageName').mockResolvedValue(undefined)

      const result = await command.command()

      expect(result).toBe(1)
      expect(command.context.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('Image name must be configured!'),
      )
    })

    it('should return error when docker command is not found', async () => {
      whichMock.mockResolvedValue(false)

      const result = await command.command()

      expect(result).toBe(2)
      expect(command.context.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('Could not find command docker!'),
      )
    })

    it('should return execC exit code on failure', async () => {
      execCMock.mockResolvedValue({ exitCode: 1 })

      const result = await command.command()

      expect(result).toBe(1)
    })
  })
})

describe('DockerCombinedCommand', () => {
  let command: any
  let mockCli: { run: Mock }

  beforeEach(async () => {
    vi.clearAllMocks()

    mockCli = {
      run: vi.fn().mockResolvedValue(0),
    }

    const { DockerCombinedCommand } = await import('../../src/Command/Docker.js')
    command = new DockerCombinedCommand()
    command.cli = mockCli
    command.context = {}
    command.dev = false
    command.deploy = false
  })

  it('should run build and tag commands', async () => {
    const result = await command.command()

    expect(mockCli.run).toHaveBeenCalledWith(['docker', 'build'], {})
    expect(mockCli.run).toHaveBeenCalledWith(['docker', 'tag'], {})
    expect(result).toBe(0)
  })

  it('should run build, tag, login, push and deploy when deploy flag is set', async () => {
    command.deploy = true

    const result = await command.command()

    expect(mockCli.run).toHaveBeenCalledWith(['docker', 'build'], {})
    expect(mockCli.run).toHaveBeenCalledWith(['docker', 'tag'], {})
    expect(mockCli.run).toHaveBeenCalledWith(['docker', 'login'], {})
    expect(mockCli.run).toHaveBeenCalledWith(['docker', 'push'], {})
    expect(mockCli.run).toHaveBeenCalledWith(['aws', 'ecs', 'deploy'], {})
    expect(result).toBe(0)
  })

  it('should pass dev flag to all commands', async () => {
    command.dev = true
    command.deploy = true

    await command.command()

    expect(mockCli.run).toHaveBeenCalledWith(['docker', 'build', '--dev'], {})
    expect(mockCli.run).toHaveBeenCalledWith(['docker', 'tag', '--dev'], {})
    expect(mockCli.run).toHaveBeenCalledWith(['docker', 'push', '--dev'], {})
    expect(mockCli.run).toHaveBeenCalledWith(['aws', 'ecs', 'deploy', '--dev'], {})
  })
})
