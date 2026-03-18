import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import JoltCommand from '../../src/Command/JoltCommand.js'
import getConfig, { getSiteConfig } from '../../src/Config.js'
import { which } from '../../src/utils.js'

vi.mock('../../src/utils.js')
vi.mock('../../src/Config.js')

// Test implementation of JoltCommand
class TestCommand extends JoltCommand {
  requiredCommands = ['test-command']

  async command(): Promise<number | undefined> {
    return 0
  }
}

// Test implementation with required config
class TestCommandWithConfig extends JoltCommand {
  requiredCommands = ['test-command']
  requiredConfig = ['testConfigKey']

  getRequiredConfig(): string[] {
    return this.requiredConfig
  }

  async command(): Promise<number | undefined> {
    return 0
  }
}

// Test implementation with conditional config
class TestCommandWithConditionalConfig extends JoltCommand {
  requiredCommands = ['test-command']
  dev = false // Mock the dev option

  getRequiredConfig(): string[] {
    return this.dev ? ['devConfigKey'] : ['prodConfigKey']
  }

  async command(): Promise<number | undefined> {
    return 0
  }
}

describe('JoltCommand', () => {
  let command: TestCommand
  let mockStderr: { write: Mock }

  beforeEach(async () => {
    vi.resetAllMocks()
    mockStderr = { write: vi.fn() }
    command = new TestCommand()
    command.context = {
      stderr: mockStderr,
    } as any
    command.cli = { binaryLabel: 'test-binary' } as any
    command.forEachSite = false // Explicitly set default

    vi.mocked(getConfig).mockResolvedValue({
      setSite: vi.fn(),
      command: vi.fn().mockResolvedValue('test-command'),
      get: vi.fn(),
      tfVar: vi.fn(),
      parseArg: vi.fn((x) => x),
      getSites: vi.fn().mockReturnValue({}),
    } as any)

    // Reset environment variables
    delete process.env.JOLT_IGNORE_REQUIRED_COMMANDS
  })

  describe('execute', () => {
    it('should check for required commands', async () => {
      vi.mocked(which).mockResolvedValueOnce('/usr/bin/test-command')

      const result = await command.execute()

      expect(result).toBe(0)
      expect(which).toHaveBeenCalledWith('test-command')
      expect(mockStderr.write).not.toHaveBeenCalled()
    })

    it('should return error code 4 when required commands are missing', async () => {
      vi.mocked(which).mockResolvedValueOnce(null)

      const result = await command.execute()

      expect(result).toBe(4)
      expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Missing the following commands'))
      expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('test-command'))
    })

    describe('when JOLT_IGNORE_REQUIRED_COMMANDS is set', () => {
      beforeEach(() => {
        process.env.JOLT_IGNORE_REQUIRED_COMMANDS = 'true'
      })

      afterEach(() => {
        delete process.env.JOLT_IGNORE_REQUIRED_COMMANDS
      })

      it('should skip command checks', async () => {
        const result = await command.execute()

        expect(result).toBe(0)
        expect(which).not.toHaveBeenCalled()
        expect(mockStderr.write).not.toHaveBeenCalled()
      })
    })

    it('should set site in config when site option is provided', async () => {
      const setSite = vi.fn()
      vi.mocked(getConfig).mockResolvedValueOnce({
        setSite,
        command: vi.fn().mockResolvedValue('test-command'),
        getSites: vi.fn().mockReturnValue({}),
      } as any)
      vi.mocked(which).mockResolvedValueOnce('/usr/bin/test-command')

      command.site = 'test-site'
      await command.execute()

      expect(setSite).toHaveBeenCalledWith('test-site')
    })
  })

  describe('requiredConfig validation', () => {
    let commandWithConfig: TestCommandWithConfig

    beforeEach(() => {
      commandWithConfig = new TestCommandWithConfig()
      commandWithConfig.context = {
        stderr: mockStderr,
      } as any
      commandWithConfig.cli = { binaryLabel: 'test-binary' } as any
      commandWithConfig.forEachSite = false // Explicitly set default
    })

    it('should check for required config entries', async () => {
      vi.mocked(which).mockResolvedValueOnce('/usr/bin/test-command')
      vi.mocked(getConfig).mockResolvedValueOnce({
        setSite: vi.fn(),
        command: vi.fn().mockResolvedValue('test-command'),
        get: vi.fn().mockResolvedValue('test-config-value'),
        getSites: vi.fn().mockReturnValue({}),
      } as any)

      const result = await commandWithConfig.execute()

      expect(result).toBe(0)
      expect(mockStderr.write).not.toHaveBeenCalled()
    })

    it('should return error code 5 when required config entries are missing', async () => {
      vi.mocked(which).mockResolvedValueOnce('/usr/bin/test-command')
      vi.mocked(getConfig).mockResolvedValueOnce({
        setSite: vi.fn(),
        command: vi.fn().mockResolvedValue('test-command'),
        get: vi.fn().mockResolvedValue(undefined),
        getSites: vi.fn().mockReturnValue({}),
      } as any)

      const result = await commandWithConfig.execute()

      expect(result).toBe(5)
      expect(mockStderr.write).toHaveBeenCalledWith(
        expect.stringContaining('Missing the following required config entries'),
      )
      expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('testConfigKey'))
    })

    describe('when JOLT_IGNORE_REQUIRED_CONFIG is set', () => {
      beforeEach(() => {
        process.env.JOLT_IGNORE_REQUIRED_CONFIG = 'true'
      })

      afterEach(() => {
        delete process.env.JOLT_IGNORE_REQUIRED_CONFIG
      })

      it('should skip config checks', async () => {
        vi.mocked(which).mockResolvedValueOnce('/usr/bin/test-command')
        vi.mocked(getConfig).mockResolvedValueOnce({
          setSite: vi.fn(),
          command: vi.fn().mockResolvedValue('test-command'),
          get: vi.fn().mockResolvedValue(undefined),
          getSites: vi.fn().mockReturnValue({}),
        } as any)

        const result = await commandWithConfig.execute()

        expect(result).toBe(0)
        expect(mockStderr.write).not.toHaveBeenCalled()
      })
    })
  })

  describe('conditional requiredConfig validation', () => {
    let conditionalCommand: TestCommandWithConditionalConfig

    beforeEach(() => {
      conditionalCommand = new TestCommandWithConditionalConfig()
      conditionalCommand.context = {
        stderr: mockStderr,
      } as any
      conditionalCommand.cli = { binaryLabel: 'test-binary' } as any
      conditionalCommand.forEachSite = false // Explicitly set default
    })

    it('should validate prod config when dev=false', async () => {
      conditionalCommand.dev = false
      vi.mocked(which).mockResolvedValueOnce('/usr/bin/test-command')
      vi.mocked(getConfig).mockResolvedValueOnce({
        setSite: vi.fn(),
        command: vi.fn().mockResolvedValue('test-command'),
        get: vi.fn().mockImplementation((key) => (key === 'prodConfigKey' ? 'prod-value' : undefined)),
        getSites: vi.fn().mockReturnValue({}),
      } as any)

      const result = await conditionalCommand.execute()

      expect(result).toBe(0)
      expect(mockStderr.write).not.toHaveBeenCalled()
    })

    it('should validate dev config when dev=true', async () => {
      conditionalCommand.dev = true
      vi.mocked(which).mockResolvedValueOnce('/usr/bin/test-command')
      vi.mocked(getConfig).mockResolvedValueOnce({
        setSite: vi.fn(),
        command: vi.fn().mockResolvedValue('test-command'),
        get: vi.fn().mockImplementation((key) => (key === 'devConfigKey' ? 'dev-value' : undefined)),
        getSites: vi.fn().mockReturnValue({}),
      } as any)

      const result = await conditionalCommand.execute()

      expect(result).toBe(0)
      expect(mockStderr.write).not.toHaveBeenCalled()
    })

    it('should fail when prod config is missing in prod mode', async () => {
      conditionalCommand.dev = false
      vi.mocked(which).mockResolvedValueOnce('/usr/bin/test-command')
      vi.mocked(getConfig).mockResolvedValueOnce({
        setSite: vi.fn(),
        command: vi.fn().mockResolvedValue('test-command'),
        get: vi.fn().mockResolvedValue(undefined),
        getSites: vi.fn().mockReturnValue({}),
      } as any)

      const result = await conditionalCommand.execute()

      expect(result).toBe(5)
      expect(mockStderr.write).toHaveBeenCalledWith(
        expect.stringContaining('Missing the following required config entries'),
      )
      expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('prodConfigKey'))
    })

    it('should fail when dev config is missing in dev mode', async () => {
      conditionalCommand.dev = true
      vi.mocked(which).mockResolvedValueOnce('/usr/bin/test-command')
      vi.mocked(getConfig).mockResolvedValueOnce({
        setSite: vi.fn(),
        command: vi.fn().mockResolvedValue('test-command'),
        get: vi.fn().mockResolvedValue(undefined),
        getSites: vi.fn().mockReturnValue({}),
      } as any)

      const result = await conditionalCommand.execute()

      expect(result).toBe(5)
      expect(mockStderr.write).toHaveBeenCalledWith(
        expect.stringContaining('Missing the following required config entries'),
      )
      expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('devConfigKey'))
    })
  })

  describe('getHeader', () => {
    it('should return formatted header with binary label', () => {
      command.cli = { binaryLabel: 'test-binary' } as any

      const header = command.getHeader()

      expect(header).toContain('⚡')
      expect(header).toContain('test-binary')
    })

    it('should include suffix when provided', () => {
      command.cli = { binaryLabel: 'test-binary' } as any

      const header = command.getHeader('test-suffix')

      expect(header).toContain('test-suffix')
    })
  })

  describe('--for-each-site option', () => {
    let mockStdout: { write: Mock }

    beforeEach(() => {
      mockStdout = { write: vi.fn() }
      command = new TestCommand() // Create fresh instance
      command.site = undefined // Explicitly clear site
      command.forEachSite = false // Explicitly clear forEachSite
      command.context = {
        stdout: mockStdout,
        stderr: mockStderr,
      } as any
      command.cli = { binaryLabel: 'test-binary' } as any
    })

    it('should return 0 when --for-each-site=false (default)', async () => {
      command.forEachSite = false
      vi.mocked(getConfig).mockResolvedValueOnce({
        setSite: vi.fn(),
        command: vi.fn().mockResolvedValue('test-command'),
        getSites: vi.fn().mockReturnValue({}),
      } as any)
      vi.mocked(which).mockResolvedValueOnce('/usr/bin/test-command')

      const result = await command.execute()

      expect(result).toBe(0)
    })

    it('should return 0 when --for-each-site=true (series mode)', async () => {
      command.forEachSite = true
      vi.mocked(getConfig).mockResolvedValueOnce({
        setSite: vi.fn(),
        command: vi.fn().mockResolvedValue('test-command'),
        getSites: vi.fn().mockReturnValue({}),
      } as any)
      vi.mocked(which).mockResolvedValueOnce('/usr/bin/test-command')

      const result = await command.execute()

      expect(result).toBe(0)
    })

    it('should return 0 when --for-each-site=series (explicit series mode)', async () => {
      command.forEachSite = 'series'
      vi.mocked(getConfig).mockResolvedValueOnce({
        setSite: vi.fn(),
        command: vi.fn().mockResolvedValue('test-command'),
        getSites: vi.fn().mockReturnValue({}),
      } as any)
      vi.mocked(which).mockResolvedValueOnce('/usr/bin/test-command')

      const result = await command.execute()

      expect(result).toBe(0)
    })

    it('should return 0 when --for-each-site=parallel (parallel mode)', async () => {
      command.forEachSite = 'parallel'
      vi.mocked(getConfig).mockResolvedValueOnce({
        setSite: vi.fn(),
        command: vi.fn().mockResolvedValue('test-command'),
        getSites: vi.fn().mockReturnValue({}),
      } as any)
      vi.mocked(which).mockResolvedValueOnce('/usr/bin/test-command')

      const result = await command.execute()

      expect(result).toBe(0)
    })

    it('should execute correct site config in parallel mode with multiple sites', async () => {
      // Create a test command that tracks which site was active when command() was called
      class TrackedCommand extends JoltCommand {
        executedSites: string[] = []

        async command(): Promise<number | undefined> {
          // Record which site was active when this command ran
          if (this.config && 'currentSite' in this.config) {
            this.executedSites.push((this.config as any).currentSite)
          }
          return 0
        }
      }

      const trackedCommand = new TrackedCommand()
      trackedCommand.forEachSite = 'parallel'
      trackedCommand.context = {
        stdout: { write: vi.fn() },
        stderr: { write: vi.fn() },
      } as any
      trackedCommand.cli = { binaryLabel: 'test-binary' } as any

      // Mock getConfig to return the base config for the first call
      vi.mocked(getConfig).mockResolvedValueOnce({
        setSite: vi.fn(),
        currentSite: 'base',
        getSites: vi.fn().mockReturnValue({ site1: {}, site2: {}, site3: {} }),
        command: vi.fn().mockResolvedValue('test-command'),
        internalConfig: {},
        configPath: '.jolt.json',
      } as any)

      // Mock getSiteConfig to return different config objects for each site
      vi.mocked(getSiteConfig).mockImplementation(async (siteName: string) => {
        const siteConfigs: Record<string, any> = {
          site1: {
            setSite: vi.fn(),
            currentSite: 'site1',
            getSites: vi.fn().mockReturnValue({ site1: {}, site2: {}, site3: {} }),
            command: vi.fn().mockResolvedValue('test-command'),
          },
          site2: {
            setSite: vi.fn(),
            currentSite: 'site2',
            getSites: vi.fn().mockReturnValue({ site1: {}, site2: {}, site3: {} }),
            command: vi.fn().mockResolvedValue('test-command'),
          },
          site3: {
            setSite: vi.fn(),
            currentSite: 'site3',
            getSites: vi.fn().mockReturnValue({ site1: {}, site2: {}, site3: {} }),
            command: vi.fn().mockResolvedValue('test-command'),
          },
        }
        return siteConfigs[siteName] as any
      })

      vi.mocked(which).mockResolvedValue('/usr/bin/test-command')

      const result = await trackedCommand.execute()

      expect(result).toBe(0)
      // Each site should be executed once
      expect(trackedCommand.executedSites.length).toBe(3)
      // In parallel mode, we should see each site executed exactly once
      expect(trackedCommand.executedSites.sort()).toEqual(['site1', 'site2', 'site3'])
    })
  })
})
