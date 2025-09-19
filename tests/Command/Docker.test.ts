import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DockerBuildCommand } from '../../src/Command/Docker.js'
import { Config } from '../../src/Config.js'

vi.mock('../../src/utils', () => ({
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
        if (key === 'buildPlatform') return Promise.resolve('linux/amd64,linux/arm64')
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
        if (key === 'buildContext') return Promise.resolve('./custom-context')
        return Promise.resolve(undefined)
      })
      vi.spyOn(mockConfig, 'getDockerfilePath').mockResolvedValue('Dockerfile')

      const args = await command.buildCommandArgs()

      expect(args).toContain('./custom-context')
    })
  })
})
