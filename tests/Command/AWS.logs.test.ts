import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { LogsTailCommand } from '../../src/Command/AWS.js'
import { execC } from '../../src/utils.js'

vi.mock('../../src/utils.js')
vi.mock('../../src/Config.js')
vi.mock('node:child_process')

// Test implementation that extends LogsTailCommand to access protected methods
class TestLogsTailCommand extends LogsTailCommand {
  public getRegionArg = vi.fn().mockResolvedValue('--region=us-east-1')
  public getRegion = vi.fn().mockResolvedValue('us-east-1')
}

describe('LogsTailCommand', () => {
  let command: TestLogsTailCommand
  let mockStdout: { write: Mock }
  let mockStderr: { write: Mock }
  let mockConfig: any

  beforeEach(async () => {
    vi.resetAllMocks()

    mockStdout = { write: vi.fn() }
    mockStderr = { write: vi.fn() }

    mockConfig = {
      command: vi.fn().mockResolvedValue('aws'),
      parseArg: vi.fn((x) => x),
    }

    command = new TestLogsTailCommand()
    command.context = {
      stdout: mockStdout,
      stderr: mockStderr,
    } as any
    command.config = mockConfig
    command.group = '/aws/lambda/test-function'
    command.clean = false
    command.args = []
  })

  describe('without clean flag', () => {
    it('should call aws logs tail with correct arguments', async () => {
      const mockExecC = vi.mocked(execC)
      mockExecC.mockResolvedValue({ exitCode: 0 } as any)

      await command.command()

      expect(mockExecC).toHaveBeenCalledWith(
        'aws',
        ['--region=us-east-1', 'logs', 'tail', '/aws/lambda/test-function', '--follow'],
        {
          context: expect.objectContaining({
            stdout: mockStdout,
            stderr: mockStderr,
          }),
        },
      )
    })

    it('should display getting logs message', async () => {
      const mockExecC = vi.mocked(execC)
      mockExecC.mockResolvedValue({ exitCode: 0 } as any)

      await command.command()

      expect(mockStdout.write).toHaveBeenCalledWith(
        expect.stringContaining('⛅ Tailing logs from /aws/lambda/test-function...'),
      )
    })
  })

  describe('with clean flag', () => {
    beforeEach(() => {
      command.clean = true
    })

    it('should display filtered message and filter spam', async () => {
      const { spawn } = await import('node:child_process')
      const mockSpawn = vi.mocked(spawn)

      const mockProc = {
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              // Simulate log output with spam and legitimate messages
              callback(
                Buffer.from(
                  'GET /health HTTP/1.1 200 OK\nImportant log message\nGET /status 200\nAnother important message\n',
                ),
              )
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            callback(0)
          }
        }),
      }
      mockSpawn.mockReturnValue(mockProc as any)

      await command.command()

      expect(mockStdout.write).toHaveBeenCalledWith(
        expect.stringContaining('⛅ Tailing logs from /aws/lambda/test-function (filtered)...'),
      )

      // Should write legitimate messages but not spam
      expect(mockStdout.write).toHaveBeenCalledWith('Important log message\n')
      expect(mockStdout.write).toHaveBeenCalledWith('Another important message\n')
    })
  })
})
