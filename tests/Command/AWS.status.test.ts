import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { ECSStatusCommand } from '../../src/Command/AWS.js'
import { execC } from '../../src/utils.js'

vi.mock('../../src/utils.js')
vi.mock('../../src/Config.js')

// Test implementation that extends ECSStatusCommand to access protected methods
class TestECSStatusCommand extends ECSStatusCommand {
  public getRegionArg = vi.fn().mockResolvedValue('--region=us-east-1')
}

describe('ECSStatusCommand', () => {
  let command: TestECSStatusCommand
  let mockStdout: { write: Mock }
  let mockStderr: { write: Mock }
  let mockConfig: any

  beforeEach(async () => {
    vi.resetAllMocks()

    mockStdout = { write: vi.fn() }
    mockStderr = { write: vi.fn() }

    mockConfig = {
      command: vi.fn().mockResolvedValue('aws'),
      get: vi.fn(),
      tfVar: vi.fn(),
      parseArg: vi.fn((x) => x),
    }

    command = new TestECSStatusCommand()
    command.context = {
      stdout: mockStdout,
      stderr: mockStderr,
    } as any
    command.config = mockConfig
    // Reset dev mode to false by default
    command.dev = false
  })

  describe('when no ECS configuration exists', () => {
    beforeEach(() => {
      mockConfig.get.mockResolvedValue(undefined)
      mockConfig.tfVar.mockResolvedValue(undefined)
    })

    it('should indicate no ECS configuration detected', async () => {
      const result = await command.command()

      expect(result).toBe(0)
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('No ECS configuration detected'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Configure ecsCluster/ecsService'))
    })
  })

  describe('when ECS cluster is configured', () => {
    beforeEach(() => {
      // Reset dev mode to false for these tests
      command.dev = false

      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'ecsCluster') {
          return Promise.resolve('test-cluster')
        }

        if (key === 'ecsService') {
          return Promise.resolve('test-service')
        }

        return Promise.resolve(undefined)
      })

      mockConfig.tfVar.mockResolvedValue(undefined)

      vi.mocked(execC).mockImplementation(async (_command, args) => {
        if (args?.includes('describe-clusters')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              clusters: [
                {
                  status: 'ACTIVE',
                  activeServicesCount: 2,
                  runningTasksCount: 3,
                  pendingTasksCount: 0,
                  registeredContainerInstancesCount: 1,
                },
              ],
            }),
            stderr: '',
            all: '',
            stdio: [],
            ipcOutput: [],
            pipedFrom: undefined,
            failed: false,
            timedOut: false,
            killed: false,
            escapedCommand: '',
            command: '',
            cwd: '',
            durationMs: 0,
            originalMessage: undefined,
          } as any
        }

        if (args?.includes('describe-services')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              services: [
                {
                  status: 'ACTIVE',
                  runningCount: 2,
                  pendingCount: 0,
                  desiredCount: 2,
                  taskDefinition: 'test-task-def:1',
                  deployments: [
                    {
                      status: 'PRIMARY',
                      taskDefinition: 'test-task-def:1',
                      runningCount: 2,
                      pendingCount: 0,
                      desiredCount: 2,
                    },
                  ],
                },
              ],
            }),
            stderr: '',
            all: '',
            stdio: [],
            ipcOutput: [],
            pipedFrom: undefined,
            failed: false,
            timedOut: false,
            killed: false,
            escapedCommand: '',
            command: '',
            cwd: '',
            durationMs: 0,
            originalMessage: undefined,
          } as any
        }

        if (args?.includes('list-tasks')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              taskArns: ['arn:aws:ecs:us-east-1:123:task/test-cluster/task1'],
            }),
            stderr: '',
            all: '',
            stdio: [],
            ipcOutput: [],
            pipedFrom: undefined,
            failed: false,
            timedOut: false,
            killed: false,
            escapedCommand: '',
            command: '',
            cwd: '',
            durationMs: 0,
            originalMessage: undefined,
          } as any
        }

        if (args?.includes('describe-tasks')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              tasks: [
                {
                  taskArn: 'arn:aws:ecs:us-east-1:123:task/test-cluster/task1',
                  lastStatus: 'RUNNING',
                  cpu: '256',
                  memory: '512',
                  createdAt: '2025-09-19T10:00:00Z',
                },
              ],
            }),
            stderr: '',
            all: '',
            stdio: [],
            ipcOutput: [],
            pipedFrom: undefined,
            failed: false,
            timedOut: false,
            killed: false,
            escapedCommand: '',
            command: '',
            cwd: '',
            durationMs: 0,
            originalMessage: undefined,
          } as any
        }

        return {
          exitCode: 1,
          stdout: '',
          stderr: '',
          all: '',
          stdio: [],
          ipcOutput: [],
          pipedFrom: undefined,
          failed: true,
          timedOut: false,
          killed: false,
          escapedCommand: '',
          command: '',
          cwd: '',
          durationMs: 0,
          originalMessage: undefined,
        } as any
      })
    })

    it('should display cluster and service information', async () => {
      const result = await command.command()

      // Get all the calls to stdout.write and strip ANSI codes
      const calls = mockStdout.write.mock.calls.map((call) => call[0])
      const escapeRegex = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
      const allOutput = calls.join('').replace(escapeRegex, '')

      expect(result).toBe(0)
      expect(allOutput).toContain('AWS ECS Status')
      expect(allOutput).toContain('Cluster: test-cluster')
      expect(allOutput).toContain('Service: test-service')
      expect(allOutput).toContain('Status: ACTIVE')
      expect(allOutput).toContain('Running Count: 2')
    })

    it('should display deployment information', async () => {
      const result = await command.command()

      expect(result).toBe(0)
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Deployments:'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('PRIMARY'))
    })

    it('should display task information', async () => {
      const result = await command.command()

      expect(result).toBe(0)
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Active Tasks:'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('task1 - '))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('CPU/Memory: 256/512'))
    })
  })

  describe('when in dev mode', () => {
    beforeEach(() => {
      command.dev = true
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'devEcsCluster') {
          return Promise.resolve('dev-cluster')
        }

        if (key === 'devEcsService') {
          return Promise.resolve('dev-service')
        }

        return Promise.resolve(undefined)
      })
    })

    it('should use dev configuration keys', async () => {
      await command.command()

      expect(mockConfig.get).toHaveBeenCalledWith('devEcsCluster')
      expect(mockConfig.get).toHaveBeenCalledWith('devEcsService')
    })
  })

  describe('when terraform variables are used', () => {
    beforeEach(() => {
      // Reset dev mode to false for these tests
      command.dev = false

      mockConfig.get.mockResolvedValue(undefined)
      mockConfig.tfVar.mockImplementation((key: string) => {
        if (key === 'ecs_cluster') {
          return Promise.resolve('tf-cluster')
        }

        if (key === 'ecs_service') {
          return Promise.resolve('tf-service')
        }

        return Promise.resolve(undefined)
      })
    })

    it('should fallback to terraform variables', async () => {
      await command.command()

      expect(mockConfig.tfVar).toHaveBeenCalledWith('ecs_cluster')
      expect(mockConfig.tfVar).toHaveBeenCalledWith('ecs_service')
    })
  })

  describe('when AWS commands fail', () => {
    beforeEach(() => {
      // Reset dev mode to false for these tests
      command.dev = false

      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'ecsCluster') {
          return Promise.resolve('test-cluster')
        }

        return Promise.resolve(undefined)
      })

      mockConfig.tfVar.mockResolvedValue(undefined)

      vi.mocked(execC).mockImplementation(async () => {
        throw new Error('AWS CLI error')
      })
    })

    it('should handle errors gracefully', async () => {
      const result = await command.command()

      expect(result).toBe(0)
      expect(mockStderr.write).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Could not retrieve cluster information'),
      )
    })
  })

  describe('when service is configured but cluster is not', () => {
    beforeEach(() => {
      // Reset dev mode to false for these tests
      command.dev = false

      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'ecsService') {
          return Promise.resolve('test-service')
        }

        return Promise.resolve(undefined)
      })
      mockConfig.tfVar.mockResolvedValue(undefined)
    })

    it('should show service but indicate missing cluster', async () => {
      const result = await command.command()

      // Get all the calls to stdout.write and strip ANSI codes
      const calls = mockStdout.write.mock.calls.map((call) => call[0])
      const escapeRegex = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
      const allOutput = calls.join('').replace(escapeRegex, '')

      expect(result).toBe(0)
      expect(allOutput).toContain('Service: test-service')
      expect(allOutput).toContain('Service configured but no cluster found')
    })
  })
})
