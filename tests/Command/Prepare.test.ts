import { readdir } from 'node:fs/promises'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrepareCommand } from '../../src/Command/Prepare.js'
import getConfig, { type Config } from '../../src/Config.js'
import { ConfigValidationError } from '../../src/errors.js'
import { directoryExists, execC } from '../../src/utils.js'

vi.mock('node:fs/promises')
vi.mock('../../src/utils.js')
vi.mock('../../src/Config.js', () => ({
  default: vi.fn(),
  Config: vi.fn(),
}))

describe('PrepareCommand', () => {
  let command: PrepareCommand
  let mockConfig: Config
  let mockCli: any
  let mockContext: any
  let mockStdout: { write: Mock }
  let mockStderr: { write: Mock }

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock stdio streams
    mockStdout = { write: vi.fn() }
    mockStderr = { write: vi.fn() }
    mockContext = {
      stdout: mockStdout,
      stderr: mockStderr,
    }

    // Mock CLI
    mockCli = {
      run: vi.fn().mockResolvedValue(0),
    }

    // Mock Config
    mockConfig = {
      command: vi.fn(),
      get: vi.fn(),
      getPrepareCommands: vi.fn().mockReturnValue([]),
      getComposeCommand: vi.fn().mockResolvedValue(['docker', ['compose']]),
      getDevPluginDelay: vi.fn().mockResolvedValue(30),
      getPackageJson: vi.fn().mockResolvedValue({}),
    } as any

    // Mock the default getConfig function to return our mock config
    vi.mocked(getConfig).mockResolvedValue(mockConfig)

    // Create command instance
    command = new PrepareCommand()
    command.config = mockConfig
    command.cli = mockCli
    command.context = mockContext

    // Set default option values
    command.husky = true
    command.tofu = true
    command.dbSeeds = true
    command.devPlugins = true
    command.pluginDelay = undefined
  })

  describe('command execution', () => {
    it('should complete successfully with all options disabled', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false
      command.devPlugins = false

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('📋 Preparing repo'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('📋 Repo prepared'))
    })

    it('should prepare Husky hooks when .husky directory exists', async () => {
      command.tofu = false
      command.dbSeeds = false
      command.devPlugins = false

      vi.mocked(directoryExists).mockResolvedValue(true)
      vi.mocked(readdir).mockResolvedValue([] as any)
      vi.mocked(mockConfig.command).mockResolvedValue('npx')

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockConfig.command).toHaveBeenCalledWith('npx')
      expect(execC).toHaveBeenCalledWith('npx', ['--yes', '--prefer-offline', 'husky'])
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('🐕 Preparing Husky hooks'))
    })

    it('should skip Husky when option is disabled', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false
      command.devPlugins = false

      vi.mocked(directoryExists).mockResolvedValue(true)
      vi.mocked(readdir).mockResolvedValue([] as any)

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockConfig.command).not.toHaveBeenCalledWith('npx')
      expect(execC).not.toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['husky']))
    })

    it('should prepare Terraform when .tf files exist', async () => {
      command.husky = false
      command.dbSeeds = false
      command.devPlugins = false

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue(['main.tf', 'variables.tf'] as any)
      vi.mocked(mockConfig.command).mockResolvedValue('terraform')

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockConfig.command).toHaveBeenCalledWith('tofu')
      expect(execC).toHaveBeenCalledWith('terraform', ['init'])
      expect(execC).toHaveBeenCalledWith('terraform', ['refresh'])
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('🌍 Preparing Terraform variables'))
    })

    it('should prepare Terraform when .tofu files exist', async () => {
      command.husky = false
      command.dbSeeds = false
      command.devPlugins = false

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue(['main.tofu'] as any)
      vi.mocked(mockConfig.command).mockResolvedValue('tofu')

      const result = await command.command()

      expect(result).toBe(0)
      expect(execC).toHaveBeenCalledWith('tofu', ['init'])
      expect(execC).toHaveBeenCalledWith('tofu', ['refresh'])
    })

    it('should skip Terraform when option is disabled', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false
      command.devPlugins = false

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue(['main.tf'] as any)

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockConfig.command).not.toHaveBeenCalledWith('tofu')
      expect(execC).not.toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['init']))
    })

    it('should download DB seeds when package.json has download-db-seeds script', async () => {
      command.husky = false
      command.tofu = false
      command.devPlugins = false

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)
      vi.mocked(mockConfig.getPackageJson).mockResolvedValue({
        scripts: { 'download-db-seeds': 'some-command' },
      } as any)
      vi.mocked(mockConfig.command).mockResolvedValue('yarn')

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockConfig.command).toHaveBeenCalledWith('yarn')
      expect(execC).toHaveBeenCalledWith('yarn', ['run', 'download-db-seeds'])
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('🛢️  Downloading DB seeds'))
    })

    it('should skip DB seeds when option is disabled', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false
      command.devPlugins = false

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)
      vi.mocked(mockConfig.getPackageJson).mockResolvedValue({
        scripts: { 'download-db-seeds': 'some-command' },
      } as any)

      const result = await command.command()

      expect(result).toBe(0)
      expect(execC).not.toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['download-db-seeds']))
    })

    it('should activate dev plugins when devPlugins config exists and wp script available', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)
      vi.mocked(mockConfig.get).mockResolvedValue('my-plugin,another-plugin')
      vi.mocked(mockConfig.getPackageJson).mockResolvedValue({
        scripts: { wp: 'wp-cli-command' },
      } as any)
      vi.mocked(mockConfig.command).mockResolvedValue('yarn')

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockConfig.getComposeCommand).toHaveBeenCalled()
      expect(execC).toHaveBeenCalledWith('docker', ['compose', 'up', '--build', '-d'], { context: mockContext })
      expect(mockCli.run).toHaveBeenCalledWith(['db', 'await', '--timeout=30', '--quiet'], mockContext)
      expect(execC).toHaveBeenCalledWith('yarn', ['run', 'wp', 'plugin', 'activate', 'my-plugin,another-plugin'])
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('🐳 Starting Compose stack'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('🔌 Activating dev plugins'))
    })

    it('should use custom plugin delay when provided', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false
      command.pluginDelay = 60

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)
      vi.mocked(mockConfig.get).mockResolvedValue('my-plugin')
      vi.mocked(mockConfig.getPackageJson).mockResolvedValue({
        scripts: { wp: 'wp-cli-command' },
      } as any)

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockCli.run).toHaveBeenCalledWith(['db', 'await', '--timeout=60', '--quiet'], mockContext)
      expect(mockConfig.getDevPluginDelay).not.toHaveBeenCalled()
    })

    it('should skip dev plugins when option is disabled', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false
      command.devPlugins = false

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)
      vi.mocked(mockConfig.get).mockResolvedValue('my-plugin')
      vi.mocked(mockConfig.getPackageJson).mockResolvedValue({
        scripts: { wp: 'wp-cli-command' },
      } as any)

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('🔌 Skipping dev plugins'))
      expect(mockConfig.getComposeCommand).not.toHaveBeenCalled()
      expect(execC).not.toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['up']))
    })

    it('should not activate dev plugins when devPlugins config is missing', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)
      vi.mocked(mockConfig.get).mockResolvedValue(undefined)

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockConfig.getComposeCommand).not.toHaveBeenCalled()
      expect(execC).not.toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['up']))
    })

    it('should not activate dev plugins when wp script is missing', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)
      vi.mocked(mockConfig.get).mockResolvedValue('my-plugin')
      vi.mocked(mockConfig.getPackageJson).mockResolvedValue({
        scripts: {},
      } as any)

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockConfig.getComposeCommand).not.toHaveBeenCalled()
      expect(execC).not.toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['up']))
    })
  })

  describe('prepare commands from config', () => {
    it('should execute early prepare commands before other steps', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false
      command.devPlugins = false

      const earlyCommands = [{ cmd: 'echo "early command"', name: 'Early Test', timing: 'early' as const }]

      vi.mocked(mockConfig.getPrepareCommands).mockReturnValueOnce(earlyCommands).mockReturnValueOnce([])

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockConfig.getPrepareCommands).toHaveBeenCalledWith('early')
      expect(mockConfig.getPrepareCommands).toHaveBeenCalledWith('normal')
      expect(mockCli.run).toHaveBeenCalledWith(['cmd', 'echo "early command"'], mockContext)
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Early Test'))
    })

    it('should execute normal prepare commands after other steps', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false
      command.devPlugins = false

      const normalCommands = [{ cmd: 'echo "normal command"', name: 'Normal Test', timing: 'normal' as const }]

      vi.mocked(mockConfig.getPrepareCommands).mockReturnValueOnce([]).mockReturnValueOnce(normalCommands)

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockCli.run).toHaveBeenCalledWith(['cmd', 'echo "normal command"'], mockContext)
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Normal Test'))
    })

    it('should execute commands with directory changes', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false
      command.devPlugins = false

      const commands = [{ cmd: 'ls', dir: '/some/path', timing: 'normal' as const }]

      vi.mocked(mockConfig.getPrepareCommands).mockReturnValueOnce([]).mockReturnValueOnce(commands)

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockCli.run).toHaveBeenCalledWith(['cmd', '--cwd', '/some/path', 'ls'], mockContext)
    })

    it('should return error code when early prepare command fails with fail=true', async () => {
      const commands = [{ cmd: 'failing-command', fail: true, timing: 'early' as const }]

      vi.mocked(mockConfig.getPrepareCommands).mockReturnValue(commands)
      vi.mocked(mockCli.run).mockResolvedValue(5)

      const result = await command.command()

      expect(result).toBe(5)
      expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Error running prepare step'))
      expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Returned code 5'))
    })

    it('should continue when normal prepare command fails with fail=true', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false
      command.devPlugins = false

      const commands = [{ cmd: 'failing-command', fail: true, timing: 'normal' as const }]

      vi.mocked(mockConfig.getPrepareCommands).mockReturnValueOnce([]).mockReturnValueOnce(commands)
      vi.mocked(mockCli.run).mockResolvedValue(3)
      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)

      const result = await command.command()

      expect(result).toBe(3)
      expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Error running prepare step'))
    })

    it('should continue when prepare command fails with fail=false', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false
      command.devPlugins = false

      const commands = [{ cmd: 'failing-command', fail: false, timing: 'normal' as const }]

      vi.mocked(mockConfig.getPrepareCommands).mockReturnValueOnce([]).mockReturnValueOnce(commands)
      vi.mocked(mockCli.run).mockResolvedValue(3)
      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockStderr.write).not.toHaveBeenCalledWith(expect.stringContaining('Error running prepare step'))
    })

    it('should handle config validation errors', async () => {
      const configError = new ConfigValidationError('Invalid prepare commands config')
      vi.mocked(mockConfig.getPrepareCommands).mockImplementation(() => {
        throw configError
      })

      const result = await command.command()

      expect(result).toBe(1)
      expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Invalid prepare commands config'))
    })

    it('should use command name as fallback when name is not provided', async () => {
      command.husky = false
      command.tofu = false
      command.dbSeeds = false
      command.devPlugins = false

      const commands = [{ cmd: 'echo test', timing: 'normal' as const }]

      vi.mocked(mockConfig.getPrepareCommands).mockReturnValueOnce([]).mockReturnValueOnce(commands)

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('echo test'))
    })
  })

  describe('integration scenarios', () => {
    it('should execute all enabled steps in correct order', async () => {
      // Enable all options
      command.husky = true
      command.tofu = true
      command.dbSeeds = true
      command.devPlugins = true

      // Set up conditions for all steps to run
      vi.mocked(directoryExists).mockResolvedValue(true) // .husky exists
      vi.mocked(readdir).mockResolvedValue(['main.tf'] as any) // terraform files exist
      vi.mocked(mockConfig.getPackageJson).mockResolvedValue({
        scripts: {
          'download-db-seeds': 'download-script',
          wp: 'wp-cli-command',
        },
      } as any)
      vi.mocked(mockConfig.get).mockResolvedValue('test-plugin')
      vi.mocked(mockConfig.command).mockResolvedValue('test-command')

      const earlyCommands = [{ cmd: 'early-cmd', timing: 'early' as const }]
      const normalCommands = [{ cmd: 'normal-cmd', timing: 'normal' as const }]

      vi.mocked(mockConfig.getPrepareCommands).mockReturnValueOnce(earlyCommands).mockReturnValueOnce(normalCommands)

      const result = await command.command()

      expect(result).toBe(0)

      // Verify order of calls
      const calls = vi.mocked(mockStdout.write).mock.calls.map((call: any[]) => call[0])

      expect(calls.some((call: string) => call.includes('📋 Preparing repo'))).toBe(true)
      expect(calls.some((call: string) => call.includes('🐕 Preparing Husky hooks'))).toBe(true)
      expect(calls.some((call: string) => call.includes('🌍 Preparing Terraform variables'))).toBe(true)
      expect(calls.some((call: string) => call.includes('🛢️  Downloading DB seeds'))).toBe(true)
      expect(calls.some((call: string) => call.includes('🐳 Starting Compose stack'))).toBe(true)
      expect(calls.some((call: string) => call.includes('🔌 Activating dev plugins'))).toBe(true)
      expect(calls.some((call: string) => call.includes('📋 Repo prepared'))).toBe(true)
    })

    it('should handle no package.json gracefully', async () => {
      command.husky = false
      command.tofu = false

      vi.mocked(directoryExists).mockResolvedValue(false)
      vi.mocked(readdir).mockResolvedValue([] as any)
      vi.mocked(mockConfig.getPackageJson).mockResolvedValue(undefined)

      const result = await command.command()

      expect(result).toBe(0)
      expect(execC).not.toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['download-db-seeds']))
    })
  })
})
