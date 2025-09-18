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
        signal: null,
      })
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
        signal: null,
      })
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
})
