import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import JoltCommand from '../../src/Command/JoltCommand.js'
import getConfig from '../../src/Config.js'
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

    vi.mocked(getConfig).mockResolvedValue({
      setSite: vi.fn(),
      command: vi.fn().mockResolvedValue('test-command'),
      get: vi.fn(),
      tfVar: vi.fn(),
      parseArg: vi.fn((x) => x),
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
      } as any)
      vi.mocked(which).mockResolvedValueOnce('/usr/bin/test-command')

      command.site = 'test-site'
      await command.execute()

      expect(setSite).toHaveBeenCalledWith('test-site')
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
})
