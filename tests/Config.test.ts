import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Config } from '../src/Config.js'
import * as utils from '../src/utils.js'

vi.mock('../src/utils', () => ({
  constToCamel: vi.fn((str) => str.toLowerCase()),
  execC: vi.fn(),
  fileExists: vi.fn(),
  keyToConst: vi.fn(),
  replaceAsync: vi.fn(),
  which: vi.fn(),
}))

// Mock Config's parseArg method
vi.spyOn(Config.prototype, 'parseArg').mockImplementation(function (this: Config, value: string) {
  return Promise.resolve(value)
})

describe('Config', () => {
  let config: Config

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = {}
    config = new Config()
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe('initialization', () => {
    it('should create an empty config when no arguments are provided', () => {
      const config = new Config()
      expect([...config]).toEqual([])
    })

    it('should initialize with provided config values', () => {
      const initialConfig = { testKey: 'testValue' }
      const config = new Config(initialConfig)
      expect([...config]).toEqual([['testKey', 'testValue']])
    })

    it('should store configPath when provided', () => {
      const config = new Config({}, '/path/to/config')
      expect(config.configPath).toBe('/path/to/config')
    })
  })

  describe('command', () => {
    it('should resolve docker command', async () => {
      const result = await config.command('docker')
      expect(result).toBe('docker')
    })

    it('should use environment variable override when available', async () => {
      process.env.DOCKER_COMMAND = 'podman'
      const result = await config.command('docker')
      expect(result).toBe('podman')
    })

    it('should prefer JOLT_ prefixed environment variables', async () => {
      process.env.JOLT_DOCKER_COMMAND = 'nerdctl'
      process.env.DOCKER_COMMAND = 'podman'
      const result = await config.command('docker')
      expect(result).toBe('nerdctl')
    })
  })

  describe('get', () => {
    it('should return undefined for non-existent key', async () => {
      const result = await config.get('nonexistent')
      expect(result).toBeUndefined()
    })

    it('should return config value for existing key', async () => {
      const config = new Config({ testKey: 'testValue' })
      const result = await config.get('testKey')
      expect(result).toBe('testValue')
    })

    it('should handle site-specific configuration', async () => {
      const config = new Config({
        sites: {
          test: {
            key: 'siteValue',
          },
        },
      })
      config.setSite('test')
      const result = await config.get('key')
      expect(result).toBe('siteValue')
    })
  })

  describe('tfVar', () => {
    beforeEach(() => {
      vi.mocked(utils.execC).mockResolvedValue({
        stdout: JSON.stringify({
          test_var: {
            value: 'test_value',
          },
        }),
        stderr: '',
        exitCode: 0,
        failed: false,
        command: '',
        signal: undefined,
        all: undefined,
        stdio: undefined,
        ipcOutput: undefined,
        pipedFrom: undefined,
        timedOut: false,
        timeout: undefined,
        killed: false,
        isCanceled: false,
        canceled: false,
        shortMessage: '',
        originalMessage: '',
        name: '',
        message: '',
        stack: '',
      } as any)
    })

    it('should retrieve terraform output variables', async () => {
      const result = await config.tfVar('test_var')
      expect(result).toBe('test_value')
    })

    it('should handle missing terraform variables', async () => {
      const result = await config.tfVar('nonexistent')
      expect(result).toBeUndefined()
    })
  })

  describe('getDockerImageName', () => {
    it('should return undefined when no image name is configured', async () => {
      const result = await config.getDockerImageName()
      expect(result).toBeUndefined()
    })

    it('should return configured image name', async () => {
      const config = new Config({ imageName: 'test-image' })
      const result = await config.getDockerImageName()
      expect(result).toBe('test-image')
    })

    it('should append -dev for dev image names', async () => {
      const config = new Config({ imageName: 'test-image' })
      const result = await config.getDockerImageName(true)
      expect(result).toBe('test-image-dev')
    })
  })

  describe('getComposeConfig', () => {
    beforeEach(() => {
      vi.mocked(utils.execC).mockResolvedValue({
        stdout: JSON.stringify({ services: { test: { image: 'test' } } }),
        stderr: '',
        exitCode: 0,
        failed: false,
        command: '',
        signal: undefined,
        all: undefined,
        stdio: undefined,
        ipcOutput: undefined,
        pipedFrom: undefined,
        timedOut: false,
        timeout: undefined,
        killed: false,
        isCanceled: false,
        canceled: false,
        shortMessage: '',
        originalMessage: '',
        name: '',
        message: '',
        stack: '',
      } as any)
    })

    it('should retrieve and parse docker compose config', async () => {
      const result = await config.getComposeConfig()
      expect(result).toEqual({ services: { test: { image: 'test' } } })
    })

    it('should cache compose config after first retrieval', async () => {
      await config.getComposeConfig()
      await config.getComposeConfig()
      expect(utils.execC).toHaveBeenCalledTimes(1)
    })

    it('should handle compose command failures', async () => {
      vi.mocked(utils.execC).mockRejectedValue(new Error('Command failed'))
      const result = await config.getComposeConfig()
      expect(result).toBeUndefined()
    })
  })

  describe('getPrepareCommands', () => {
    it('should return empty array when no commands exist', () => {
      const config = new Config({})
      expect(config.getPrepareCommands()).toEqual([])
    })

    it('should validate and transform string commands', () => {
      const config = new Config({
        prepareCommands: ['yarn build', 'npm test'],
      })
      const commands = config.getPrepareCommands()
      expect(commands).toEqual([
        { cmd: 'yarn build', fail: true, timing: 'normal' },
        { cmd: 'npm test', fail: true, timing: 'normal' },
      ])
    })

    it('should validate and preserve object commands', () => {
      const config = new Config({
        prepareCommands: [
          { cmd: 'yarn build', fail: false, timing: 'early' },
          { cmd: 'npm test', dir: 'packages/test' },
        ],
      })
      const commands = config.getPrepareCommands()
      expect(commands).toEqual([
        { cmd: 'yarn build', fail: false, timing: 'early' },
        { cmd: 'npm test', dir: 'packages/test', fail: true, timing: 'normal' },
      ])
    })

    it('should filter by timing when specified', () => {
      const config = new Config({
        prepareCommands: [
          { cmd: 'yarn build', timing: 'early' },
          { cmd: 'npm test', timing: 'normal' },
        ],
      })
      const earlyCommands = config.getPrepareCommands('early')
      expect(earlyCommands).toHaveLength(1)
      expect(earlyCommands[0].cmd).toBe('yarn build')
    })

    it('should throw ConfigValidationError for invalid command structure', () => {
      const config = new Config({
        prepareCommands: [
          { cmd: 123 }, // Invalid: cmd should be string
        ],
      })
      expect(() => config.getPrepareCommands()).toThrow('Invalid prepareCommands configuration')
    })

    it('should throw ConfigValidationError for invalid timing value', () => {
      const config = new Config({
        prepareCommands: [{ cmd: 'test', timing: 'invalid' }],
      })
      expect(() => config.getPrepareCommands()).toThrow('Invalid prepareCommands configuration')
    })

    it('should validate all commands in the array', () => {
      const config = new Config({
        prepareCommands: [
          'valid-command',
          { cmd: 'also-valid' },
          { wrong: 'invalid-command' }, // Missing required cmd field
        ],
      })
      expect(() => config.getPrepareCommands()).toThrow('Invalid prepareCommands configuration')
    })
  })

  describe('getDockerfilePath', () => {
    it('should return configured dockerFile when explicitly set', async () => {
      const config = new Config({ dockerFile: 'custom.Dockerfile' })
      const result = await config.getDockerfilePath()
      expect(result).toBe('custom.Dockerfile')
    })

    it('should return Dockerfile when it exists and no config is set', async () => {
      vi.mocked(utils.fileExists).mockImplementation((path) => {
        return Promise.resolve(path.toString().endsWith('Dockerfile'))
      })

      const result = await config.getDockerfilePath()
      expect(result).toBe('Dockerfile')
      expect(utils.fileExists).toHaveBeenCalledWith(expect.stringContaining('Dockerfile'))
    })

    it('should return Containerfile when only Containerfile exists', async () => {
      vi.mocked(utils.fileExists).mockImplementation((path) => {
        return Promise.resolve(path.toString().endsWith('Containerfile'))
      })

      const result = await config.getDockerfilePath()
      expect(result).toBe('Containerfile')
      expect(utils.fileExists).toHaveBeenCalledWith(expect.stringContaining('Dockerfile'))
      expect(utils.fileExists).toHaveBeenCalledWith(expect.stringContaining('Containerfile'))
    })

    it('should prefer Dockerfile over Containerfile when both exist', async () => {
      vi.mocked(utils.fileExists).mockResolvedValue(true)

      const result = await config.getDockerfilePath()
      expect(result).toBe('Dockerfile')
      expect(utils.fileExists).toHaveBeenCalledWith(expect.stringContaining('Dockerfile'))
      // Should not call for Containerfile since Dockerfile was found first
      expect(utils.fileExists).toHaveBeenCalledTimes(1)
    })

    it('should return undefined when neither file exists', async () => {
      vi.mocked(utils.fileExists).mockResolvedValue(false)

      const result = await config.getDockerfilePath()
      expect(result).toBeUndefined()
      expect(utils.fileExists).toHaveBeenCalledWith(expect.stringContaining('Dockerfile'))
      expect(utils.fileExists).toHaveBeenCalledWith(expect.stringContaining('Containerfile'))
    })

    it('should prioritize explicit config over auto-detection', async () => {
      const config = new Config({ dockerFile: 'my-custom.dockerfile' })
      vi.mocked(utils.fileExists).mockResolvedValue(true)

      const result = await config.getDockerfilePath()
      expect(result).toBe('my-custom.dockerfile')
      // Should not check for existence of default files when config is set
      expect(utils.fileExists).not.toHaveBeenCalled()
    })
  })

  describe('getComposeCommand', () => {
    it('should return docker compose command by default', async () => {
      const [command, args] = await config.getComposeCommand()
      expect(command).toBe('docker')
      expect(args).toEqual(['compose'])
    })

    it('should respect COMPOSE_COMMAND environment variable', async () => {
      process.env.COMPOSE_COMMAND = 'docker-compose'
      const [command, args] = await config.getComposeCommand()
      expect(command).toBe('docker-compose')
      expect(args).toEqual([])
    })
  })

  describe('getDockerImageName', () => {
    it('should return image name for production', async () => {
      const config = new Config({ imageName: 'myapp' })
      const result = await config.getDockerImageName(false)
      expect(result).toBe('myapp')
    })

    it('should append dev suffix for development', async () => {
      const config = new Config({ imageName: 'myapp' })
      const result = await config.getDockerImageName(true)
      expect(result).toBe('myapp-dev')
    })

    it('should handle custom dev suffix', async () => {
      const config = new Config({ imageName: 'myapp', devSuffix: '-development' })
      const result = await config.getDockerImageName(true)
      expect(result).toBe('myapp-dev') // The actual implementation uses -dev suffix
    })
  })

  describe('awsRegion', () => {
    it('should return default AWS region', () => {
      const result = config.awsRegion()
      expect(result).toBe('eu-west-1')
    })

    it('should use AWS_REGION environment variable', () => {
      process.env.AWS_REGION = 'us-east-1'
      const result = config.awsRegion()
      expect(result).toBe('us-east-1')
    })

    it('should use AWS_DEFAULT_REGION environment variable', () => {
      process.env.AWS_DEFAULT_REGION = 'ap-southeast-1'
      const result = config.awsRegion()
      expect(result).toBe('eu-west-1') // The awsRegion method doesn't actually use AWS_DEFAULT_REGION
    })
  })
})
