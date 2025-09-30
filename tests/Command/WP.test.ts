import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { WPCLICommand, WPCommand } from '../../src/Command/WP.js'
import { Config } from '../../src/Config.js'
import { execC, which } from '../../src/utils.js'

vi.mock('../../src/utils.js')
vi.mock('node:os', () => ({
  userInfo: vi.fn(() => ({ uid: 1000, gid: 1000 })),
}))

describe('WPCommand', () => {
  let command: WPCommand
  let mockCli: { run: Mock }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCli = { run: vi.fn().mockResolvedValue(0) }
    command = new WPCommand()
    // @ts-expect-error - Mocking cli for testing
    command.cli = mockCli
    command.wpArgs = ['version']
  })

  it('should proxy to wp-cli command', async () => {
    const result = await command.command()

    expect(mockCli.run).toHaveBeenCalledWith(['wp-cli', 'version'])
    expect(result).toBe(0)
  })
})

describe('WPCLICommand', () => {
  let command: WPCLICommand
  let mockConfig: Config
  let mockContext: {
    stderr: { write: Mock }
    stdin: any
    stdout: any
    env: any
    colorDepth: number
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockContext = {
      stderr: { write: vi.fn() },
      stdin: {},
      stdout: {},
      env: {},
      colorDepth: 8,
    }

    mockConfig = new Config({})
    vi.spyOn(mockConfig, 'parseArg').mockImplementation((value: string) => Promise.resolve(value))
    vi.spyOn(mockConfig, 'getComposeCommand').mockResolvedValue(['docker', ['compose']])
    vi.spyOn(mockConfig, 'getComposeConfig').mockResolvedValue({
      services: {
        'wp-cli': {
          image: 'wordpress:cli',
        },
      },
    })

    command = new WPCLICommand()
    command.config = mockConfig
    // @ts-expect-error - Mocking context for testing
    command.context = mockContext
    command.wpArgs = ['plugin', 'list']
  })

  describe('when wp executable exists and no wp script in package.json', () => {
    beforeEach(() => {
      vi.mocked(which).mockResolvedValue('/usr/local/bin/wp')
      vi.spyOn(mockConfig, 'getPackageJson').mockResolvedValue({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          build: 'webpack',
          // No wp script
        },
      })
      vi.mocked(execC).mockResolvedValue({ exitCode: 0 } as any)
    })

    it('should use wp executable directly', async () => {
      const result = await command.command()

      expect(which).toHaveBeenCalledWith('wp')
      expect(mockConfig.getPackageJson).toHaveBeenCalled()
      expect(execC).toHaveBeenCalledWith('wp', ['plugin', 'list'], { context: mockContext, reject: false })
      expect(result).toBe(0)
    })

    it('should add cli arg when needed', async () => {
      command.wpArgs = ['info']

      const result = await command.command()

      expect(execC).toHaveBeenCalledWith('wp', ['cli', 'info'], { context: mockContext, reject: false })
      expect(result).toBe(0)
    })
  })

  describe('when wp script exists in package.json', () => {
    beforeEach(() => {
      vi.mocked(which).mockResolvedValue('/usr/local/bin/wp')
      vi.spyOn(mockConfig, 'getPackageJson').mockResolvedValue({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          wp: 'wp-cli-command',
          build: 'webpack',
        },
      })
      vi.mocked(execC).mockResolvedValue({ exitCode: 0 } as any)
      vi.spyOn(command, 'getContainerName').mockResolvedValue('wp-cli')
      vi.spyOn(command, 'getContainerProfile').mockResolvedValue(undefined)
    })

    it('should fall back to container approach', async () => {
      const result = await command.command()

      expect(which).toHaveBeenCalledWith('wp')
      expect(mockConfig.getPackageJson).toHaveBeenCalled()
      expect(mockConfig.getComposeCommand).toHaveBeenCalled()
      expect(execC).toHaveBeenCalledWith(
        'docker',
        ['compose', '', 'run', '--rm', "--user='1000:1000'", 'wp-cli', 'wp', 'plugin', 'list'],
        { context: mockContext, reject: false },
      )
      expect(result).toBe(0)
    })
  })

  describe('when wp executable does not exist', () => {
    beforeEach(() => {
      vi.mocked(which).mockResolvedValue(null)
      vi.spyOn(mockConfig, 'getPackageJson').mockResolvedValue({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          build: 'webpack',
        },
      })
      vi.mocked(execC).mockResolvedValue({ exitCode: 0 } as any)
      vi.spyOn(command, 'getContainerName').mockResolvedValue('wp-cli')
      vi.spyOn(command, 'getContainerProfile').mockResolvedValue(undefined)
    })

    it('should fall back to container approach', async () => {
      const result = await command.command()

      expect(which).toHaveBeenCalledWith('wp')
      expect(mockConfig.getPackageJson).toHaveBeenCalled()
      expect(mockConfig.getComposeCommand).toHaveBeenCalled()
      expect(execC).toHaveBeenCalledWith(
        'docker',
        ['compose', '', 'run', '--rm', "--user='1000:1000'", 'wp-cli', 'wp', 'plugin', 'list'],
        { context: mockContext, reject: false },
      )
      expect(result).toBe(0)
    })
  })

  describe('when no container found', () => {
    beforeEach(() => {
      vi.mocked(which).mockResolvedValue(null)
      vi.spyOn(mockConfig, 'getPackageJson').mockResolvedValue({
        name: 'test-project',
        version: '1.0.0',
      })
      vi.spyOn(command, 'getContainerName').mockResolvedValue(undefined)
    })

    it('should return error code 1', async () => {
      const result = await command.command()

      expect(mockContext.stderr.write).toHaveBeenCalledWith(expect.stringContaining("Couldn't find a WP CLI container"))
      expect(result).toBe(1)
    })
  })

  describe('getContainerName', () => {
    it('should return configured container name', async () => {
      vi.spyOn(mockConfig, 'has').mockReturnValue(true)
      vi.spyOn(mockConfig, 'get').mockResolvedValue('custom-wp-cli')

      const containerName = await command.getContainerName()

      expect(containerName).toBe('custom-wp-cli')
    })

    it('should auto-detect wp-cli container from compose config', async () => {
      // Create a fresh command for this test
      const freshCommand = new WPCLICommand()
      const freshConfig = new Config({})
      vi.spyOn(freshConfig, 'has').mockReturnValue(false)
      vi.spyOn(freshConfig, 'getComposeConfig').mockResolvedValue({
        services: {
          'wp-cli': {
            image: 'wordpress:wp-cli',
          },
        },
      })
      freshCommand.config = freshConfig

      const containerName = await freshCommand.getContainerName()

      expect(containerName).toBe('wp-cli')
    })

    it('should return undefined when no wp-cli container found', async () => {
      vi.spyOn(mockConfig, 'has').mockReturnValue(false)
      vi.spyOn(mockConfig, 'getComposeConfig').mockResolvedValue({
        services: {
          web: {
            image: 'nginx',
          },
        },
      })

      const containerName = await command.getContainerName()

      expect(containerName).toBeUndefined()
    })
  })

  describe('getContainerProfile', () => {
    it('should return configured profile', async () => {
      vi.spyOn(mockConfig, 'has').mockReturnValue(true)
      vi.spyOn(mockConfig, 'get').mockResolvedValue('wp-profile')

      const profile = await command.getContainerProfile('wp-cli')

      expect(profile).toBe('wp-profile')
    })

    it('should return first profile from service config', async () => {
      vi.spyOn(mockConfig, 'has').mockReturnValue(false)
      vi.spyOn(mockConfig, 'getComposeConfig').mockResolvedValue({
        services: {
          'wp-cli': {
            image: 'wordpress:cli',
            profiles: ['wp', 'development'],
          },
        },
      })

      const profile = await command.getContainerProfile('wp-cli')

      expect(profile).toBe('wp')
    })

    it('should return undefined when no profile configured', async () => {
      vi.spyOn(mockConfig, 'has').mockReturnValue(false)

      const profile = await command.getContainerProfile('wp-cli')

      expect(profile).toBeUndefined()
    })
  })
})
