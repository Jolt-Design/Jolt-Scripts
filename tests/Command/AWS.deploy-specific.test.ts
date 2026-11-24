import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { ECSDeploySpecificCommand } from '../../src/Command/AWS.js'
import { execC } from '../../src/utils.js'

vi.mock('../../src/utils.js')
vi.mock('../../src/Config.js')

class TestCommand extends ECSDeploySpecificCommand {
  public getRegionArg = vi.fn().mockResolvedValue('--region=us-east-1')
  public getRegion = vi.fn().mockResolvedValue('us-east-1')
}

describe('ECSDeploySpecificCommand', () => {
  let command: TestCommand
  let cli: { run: Mock }
  let tfVar: Mock
  let get: Mock

  beforeEach(() => {
    vi.resetAllMocks()
    tfVar = vi.fn(async (key: string) => `tf:${key}`)
    get = vi.fn()
    cli = { run: vi.fn().mockResolvedValue(0) }

    vi.mocked(execC).mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ containerDefinitions: [{ image: 'repo:old' }] }),
    } as any)

    command = new TestCommand()
    command.context = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } } as any
    command.cli = cli as any
    command.config = { command: vi.fn().mockResolvedValue('aws'), get, tfVar, parseArg: vi.fn((x) => x) } as any
    command.tag = 'abc123'
    command.dev = false
    command.region = undefined
  })

  it('uses the production outputs and deploys production', async () => {
    expect(await command.command()).toBe(0)
    expect(tfVar).toHaveBeenCalledWith('ecs_cluster')
    expect(tfVar).toHaveBeenCalledWith('ecs_service')
    expect(tfVar).toHaveBeenCalledWith('ecs_task_definition')
    expect(cli.run).toHaveBeenCalledWith(['aws', 'ecs', 'deploy'])
  })

  it('uses the dev outputs and passes --dev and --region to the deploy', async () => {
    command.dev = true
    command.region = 'us-east-1'

    expect(await command.command()).toBe(0)
    expect(tfVar).toHaveBeenCalledWith('dev_ecs_cluster')
    expect(tfVar).toHaveBeenCalledWith('dev_ecs_service')
    expect(tfVar).toHaveBeenCalledWith('dev_ecs_task_definition')
    expect(cli.run).toHaveBeenCalledWith(['aws', 'ecs', 'deploy', '--dev', '--region', 'us-east-1'])
  })

  it('prefers the dev config keys over Terraform outputs with --dev', async () => {
    command.dev = true
    get.mockImplementation(async (key: string) => `cfg:${key}`)

    await command.command()

    expect(get).toHaveBeenCalledWith('devEcsCluster')
    expect(get).toHaveBeenCalledWith('devEcsService')
    expect(tfVar).not.toHaveBeenCalledWith('dev_ecs_cluster')
    expect(tfVar).not.toHaveBeenCalledWith('dev_ecs_service')
  })
})
