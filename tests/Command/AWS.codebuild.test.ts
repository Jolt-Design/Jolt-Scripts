import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { CodeBuildStartCommand } from '../../src/Command/AWS.js'
import { delay, execC } from '../../src/utils.js'

vi.mock('../../src/utils.js')
vi.mock('../../src/Config.js')

// Mock AbortController globally
const mockAbortController = {
  signal: { aborted: false },
  abort: vi.fn(),
}

global.AbortController = vi.fn(() => mockAbortController) as any

// Test implementation that extends CodeBuildStartCommand to access protected methods
class TestCodeBuildStartCommand extends CodeBuildStartCommand {
  public getRegionArg = vi.fn().mockResolvedValue('--region=us-east-1')
  public waitForBuildCompletion = vi.fn()

  // Expose the real method for testing
  public realWaitForBuildCompletion(buildId: string): Promise<string> {
    return super.waitForBuildCompletion(buildId)
  }
}

describe('CodeBuildStartCommand', () => {
  let command: TestCodeBuildStartCommand
  let mockStdout: { write: Mock }
  let mockStderr: { write: Mock }
  let mockConfig: any

  beforeEach(async () => {
    vi.resetAllMocks()
    mockAbortController.abort.mockClear()

    mockStdout = { write: vi.fn() }
    mockStderr = { write: vi.fn() }

    mockConfig = {
      command: vi.fn().mockResolvedValue('aws'),
      get: vi.fn(),
      tfVar: vi.fn(),
      parseArg: vi.fn((x) => x),
    }

    command = new TestCodeBuildStartCommand()
    command.config = mockConfig
    command.context = {
      stdout: mockStdout,
      stderr: mockStderr,
      stdin: process.stdin,
    } as any
    command.dev = false
    command.batch = false
    command.project = undefined
  })

  describe('successful build execution', () => {
    it('should start build and monitor until completion with SUCCEEDED status', async () => {
      // Mock config to return a project name
      mockConfig.get.mockResolvedValueOnce('test-project')

      // Mock start-build response
      const mockBuildOutput = {
        build: {
          id: 'test-build-123',
          projectName: 'test-project',
          buildNumber: 1,
        },
      }

      // Mock execC for build start
      ;(execC as Mock).mockResolvedValueOnce({
        stdout: JSON.stringify(mockBuildOutput),
      })

      // Mock execC for log tailing (never resolves since it should be long-running)
      ;(execC as Mock).mockImplementationOnce(() => new Promise(() => {}))

      // Mock waitForBuildCompletion to return SUCCEEDED
      command.waitForBuildCompletion.mockResolvedValueOnce('SUCCEEDED')

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockAbortController.abort).toHaveBeenCalled()
      expect(mockStdout.write).toHaveBeenCalledWith(
        expect.stringContaining('⛅ Starting the test-project CodeBuild project...'),
      )
      expect(mockStdout.write).toHaveBeenCalledWith(
        expect.stringContaining(
          '⛅ Tailing build logs (automatically stops when build completes). Nothing will show until source download completes...',
        ),
      )
      expect(command.waitForBuildCompletion).toHaveBeenCalledWith('test-build-123')
      // Process termination is handled by AbortController, no need to check kill() method
    })

    it('should use cancelSignal with execC for log tailing', async () => {
      mockConfig.get.mockResolvedValueOnce('test-project')

      const mockBuildOutput = {
        build: {
          id: 'test-build-123',
          projectName: 'test-project',
          buildNumber: 1,
        },
      }
      ;(execC as Mock).mockResolvedValueOnce({
        stdout: JSON.stringify(mockBuildOutput),
      })

      // Mock execC for log tailing
      ;(execC as Mock).mockImplementationOnce(() => new Promise(() => {}))
      command.waitForBuildCompletion.mockResolvedValueOnce('SUCCEEDED')

      await command.command()

      // Verify that the second execC call (log tailing) includes cancelSignal
      expect(execC).toHaveBeenCalledWith(
        'aws',
        expect.arrayContaining(['logs', 'tail', '--follow']),
        expect.objectContaining({
          cancelSignal: mockAbortController.signal,
        }),
      )
    })

    it('should return 1 for failed build status', async () => {
      mockConfig.get.mockResolvedValueOnce('test-project')

      const mockBuildOutput = {
        build: {
          id: 'test-build-123',
          projectName: 'test-project',
          buildNumber: 1,
        },
      }
      // Mock execC for build start
      ;(execC as Mock).mockResolvedValueOnce({
        stdout: JSON.stringify(mockBuildOutput),
      })

      // Mock execC for log tailing (never resolves since it should be long-running)
      ;(execC as Mock).mockImplementationOnce(() => new Promise(() => {}))
      command.waitForBuildCompletion.mockResolvedValueOnce('FAILED')

      const result = await command.command()

      expect(result).toBe(1)
      expect(command.waitForBuildCompletion).toHaveBeenCalledWith('test-build-123')
    })
  })

  describe('error handling', () => {
    it('should return 1 when no project is configured', async () => {
      mockConfig.get.mockResolvedValue(undefined)
      mockConfig.tfVar.mockResolvedValue(undefined)

      const result = await command.command()

      expect(result).toBe(1)
      expect(mockStderr.write).toHaveBeenCalledWith(
        expect.stringContaining('⛅ Failed to find a configured CodeBuild project'),
      )
    })

    it('should return 5 when start-build command fails', async () => {
      mockConfig.get.mockResolvedValueOnce('test-project')
      ;(execC as Mock).mockResolvedValueOnce({ stdout: undefined })

      const result = await command.command()

      expect(result).toBe(5)
      expect(mockStderr.write).toHaveBeenCalledWith(
        expect.stringContaining('⛅ Missing output for codebuild start command'),
      )
    })
  })

  describe('configuration options', () => {
    it('should use dev project when --dev flag is set', async () => {
      command.dev = true
      mockConfig.get.mockResolvedValueOnce('dev-test-project')

      const mockBuildOutput = {
        build: {
          id: 'test-build-123',
          projectName: 'dev-test-project',
          buildNumber: 1,
        },
      }
      ;(execC as Mock).mockResolvedValueOnce({
        stdout: JSON.stringify(mockBuildOutput),
      })

      // Mock the log tailing process
      ;(execC as Mock).mockResolvedValueOnce({ stdout: 'log output' })
      command.waitForBuildCompletion.mockResolvedValueOnce('SUCCEEDED')

      await command.command()

      expect(mockConfig.get).toHaveBeenCalledWith('devCodebuildProject')
      expect(mockStdout.write).toHaveBeenCalledWith(
        expect.stringContaining('⛅ Starting the dev-test-project CodeBuild project...'),
      )
    })

    it('should use custom project when provided', async () => {
      command.project = 'custom-project'
      mockConfig.parseArg.mockResolvedValueOnce('custom-project')

      const mockBuildOutput = {
        build: {
          id: 'test-build-123',
          projectName: 'custom-project',
          buildNumber: 1,
        },
      }
      ;(execC as Mock).mockResolvedValueOnce({
        stdout: JSON.stringify(mockBuildOutput),
      })

      // Mock the log tailing process
      ;(execC as Mock).mockResolvedValueOnce({ stdout: 'log output' })
      command.waitForBuildCompletion.mockResolvedValueOnce('SUCCEEDED')

      await command.command()

      expect(mockConfig.parseArg).toHaveBeenCalledWith('custom-project')
      expect(mockStdout.write).toHaveBeenCalledWith(
        expect.stringContaining('⛅ Starting the custom-project CodeBuild project...'),
      )
    })

    it('should use batch build when --batch flag is set', async () => {
      command.batch = true
      mockConfig.get.mockResolvedValueOnce('test-project')

      const mockBuildOutput = {
        build: {
          id: 'test-build-123',
          projectName: 'test-project',
          buildNumber: 1,
        },
      }
      ;(execC as Mock).mockResolvedValueOnce({
        stdout: JSON.stringify(mockBuildOutput),
      })

      // Mock the log tailing process
      ;(execC as Mock).mockResolvedValueOnce({ stdout: 'log output' })
      command.waitForBuildCompletion.mockResolvedValueOnce('SUCCEEDED')

      await command.command()

      expect(execC).toHaveBeenCalledWith('aws', expect.arrayContaining(['start-build-batch']), expect.any(Object))
    })
  })
})

describe('waitForBuildCompletion', () => {
  let command: TestCodeBuildStartCommand
  let mockConfig: any

  beforeEach(() => {
    vi.resetAllMocks()

    mockConfig = {
      command: vi.fn().mockResolvedValue('aws'),
    }

    command = new TestCodeBuildStartCommand()
    command.config = mockConfig
  })

  it('should poll until build reaches terminal state', async () => {
    command.getRegionArg = vi.fn().mockResolvedValue('--region=us-east-1')

    // Mock first call returns IN_PROGRESS, second call returns SUCCEEDED
    ;(execC as Mock)
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          builds: [{ buildStatus: 'IN_PROGRESS' }],
        }),
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          builds: [{ buildStatus: 'SUCCEEDED' }],
        }),
      })

    // Mock delay to resolve immediately for faster test
    ;(delay as Mock).mockResolvedValue(null)

    const result = await command.realWaitForBuildCompletion('test-build-123')

    expect(result).toBe('SUCCEEDED')
    expect(execC).toHaveBeenCalledTimes(2)
    expect(execC).toHaveBeenCalledWith(
      'aws',
      ['--region=us-east-1', 'codebuild', 'batch-get-builds', '--ids=test-build-123'],
      { env: { AWS_PAGER: '' } },
    )
  })

  it('should handle all terminal states', async () => {
    command.getRegionArg = vi.fn().mockResolvedValue('--region=us-east-1')
    ;(delay as Mock).mockResolvedValue(null)

    const terminalStates = ['SUCCEEDED', 'FAILED', 'FAULT', 'STOPPED', 'TIMED_OUT']

    for (const status of terminalStates) {
      ;(execC as Mock).mockResolvedValueOnce({
        stdout: JSON.stringify({
          builds: [{ buildStatus: status }],
        }),
      })

      const result = await command.realWaitForBuildCompletion(`test-build-${status}`)
      expect(result).toBe(status)
    }
  })
})
