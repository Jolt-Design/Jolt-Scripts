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

describe('WPUpdateMergeCommand', () => {
  let command: any
  let mockConfig: Config
  let mockContext: {
    stderr: { write: Mock }
    stdin: any
    stdout: { write: Mock }
    env: any
    colorDepth: number
  }

  beforeEach(async () => {
    vi.clearAllMocks()

    mockContext = {
      stderr: { write: vi.fn() },
      stdin: {},
      stdout: { write: vi.fn() },
      env: {},
      colorDepth: 256,
    }

    mockConfig = new Config(mockContext)
    vi.spyOn(mockConfig, 'loadWordPressConfig').mockResolvedValue({})
    vi.spyOn(mockConfig, 'get').mockResolvedValue('master')
    vi.spyOn(mockConfig, 'command').mockResolvedValue('git')

    const { WPUpdateMergeCommand } = await import('../../src/Command/WP.js')
    command = new WPUpdateMergeCommand()
    command.config = mockConfig
    command.context = mockContext
    command.logo = '⚡'

    // Reset execC mock to return success by default
    vi.mocked(execC).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any)
  })

  it('should perform regular merge by default', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC).mockResolvedValue({ stdout: 'joltWpUpdate/feature-branch', stderr: '', exitCode: 0 } as any)

    // Create a fresh command instance to avoid state pollution
    const { WPUpdateMergeCommand } = await import('../../src/Command/WP.js')
    const freshCommand = new WPUpdateMergeCommand()
    freshCommand.config = mockConfig
    freshCommand.context = mockContext
    freshCommand.logo = '⚡'

    // Manually set the option values since we're not parsing CLI args
    freshCommand.rebase = false
    freshCommand.ffOnly = false
    freshCommand.noFf = false

    const result = await freshCommand.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledTimes(3)
    expect(execC).toHaveBeenCalledWith('git', ['branch', '--show-current'])
    expect(execC).toHaveBeenCalledWith('git', ['switch', 'master'], expect.any(Object))
    expect(execC).toHaveBeenCalledWith('git', ['merge', 'joltWpUpdate/feature-branch'], expect.any(Object))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Successfully merged'))
  })

  it('should perform rebase when --rebase option is used', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC).mockResolvedValue({ stdout: 'joltWpUpdate/feature-branch', stderr: '', exitCode: 0 } as any)

    // Create a fresh command instance
    const { WPUpdateMergeCommand } = await import('../../src/Command/WP.js')
    const freshCommand = new WPUpdateMergeCommand()
    freshCommand.config = mockConfig
    freshCommand.context = mockContext
    freshCommand.logo = '⚡'

    // Set the options
    freshCommand.rebase = true
    freshCommand.ffOnly = false
    freshCommand.noFf = false

    const result = await freshCommand.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledTimes(3)
    expect(execC).toHaveBeenCalledWith('git', ['branch', '--show-current'])
    expect(execC).toHaveBeenCalledWith('git', ['switch', 'master'], expect.any(Object))
    expect(execC).toHaveBeenCalledWith('git', ['rebase', 'joltWpUpdate/feature-branch'], expect.any(Object))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('WordPress Update Rebase'))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Successfully rebased'))
  })

  it('should use --ff-only when option is set', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC).mockResolvedValue({ stdout: 'joltWpUpdate/feature-branch', stderr: '', exitCode: 0 } as any)

    // Create a fresh command instance
    const { WPUpdateMergeCommand } = await import('../../src/Command/WP.js')
    const freshCommand = new WPUpdateMergeCommand()
    freshCommand.config = mockConfig
    freshCommand.context = mockContext
    freshCommand.logo = '⚡'

    // Set the options
    freshCommand.rebase = false
    freshCommand.ffOnly = true
    freshCommand.noFf = false

    const result = await freshCommand.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledTimes(3)
    expect(execC).toHaveBeenCalledWith('git', ['branch', '--show-current'])
    expect(execC).toHaveBeenCalledWith('git', ['switch', 'master'], expect.any(Object))
    expect(execC).toHaveBeenCalledWith('git', ['merge', '--ff-only', 'joltWpUpdate/feature-branch'], expect.any(Object))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('fast-forward only'))
  })

  it('should use --no-ff when option is set', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC).mockResolvedValue({ stdout: 'joltWpUpdate/feature-branch', stderr: '', exitCode: 0 } as any)

    // Create a fresh command instance
    const { WPUpdateMergeCommand } = await import('../../src/Command/WP.js')
    const freshCommand = new WPUpdateMergeCommand()
    freshCommand.config = mockConfig
    freshCommand.context = mockContext
    freshCommand.logo = '⚡'

    // Set the options
    freshCommand.rebase = false
    freshCommand.ffOnly = false
    freshCommand.noFf = true

    const result = await freshCommand.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledTimes(3)
    expect(execC).toHaveBeenCalledWith('git', ['branch', '--show-current'])
    expect(execC).toHaveBeenCalledWith('git', ['switch', 'master'], expect.any(Object))
    expect(execC).toHaveBeenCalledWith('git', ['merge', '--no-ff', 'joltWpUpdate/feature-branch'], expect.any(Object))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('no fast-forward'))
  })

  it('should fail if not on WordPress update branch', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC).mockResolvedValueOnce({ stdout: 'main', stderr: '', exitCode: 0 } as any)

    // Create a fresh command instance
    const { WPUpdateMergeCommand } = await import('../../src/Command/WP.js')
    const freshCommand = new WPUpdateMergeCommand()
    freshCommand.config = mockConfig
    freshCommand.context = mockContext
    freshCommand.logo = '⚡'

    // Set default option values
    freshCommand.rebase = false
    freshCommand.ffOnly = false
    freshCommand.noFf = false

    const result = await freshCommand.command()

    expect(result).toBe(1)
    expect(mockContext.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Not currently on a WordPress update branch'),
    )
  })
})

describe('WPUpdateCleanCommand', () => {
  let command: any
  let mockConfig: Config
  let mockContext: {
    stderr: { write: Mock }
    stdin: any
    stdout: { write: Mock }
    env: any
    colorDepth: number
  }

  beforeEach(async () => {
    vi.clearAllMocks()

    mockContext = {
      stderr: { write: vi.fn() },
      stdin: {},
      stdout: { write: vi.fn() },
      env: {},
      colorDepth: 256,
    }

    mockConfig = new Config(mockContext)
    vi.spyOn(mockConfig, 'loadWordPressConfig').mockResolvedValue({})
    vi.spyOn(mockConfig, 'command').mockResolvedValue('git')

    const { WPUpdateCleanCommand } = await import('../../src/Command/WP.js')
    command = new WPUpdateCleanCommand()
    command.config = mockConfig
    command.context = mockContext
    command.logo = '⚡'

    // Reset execC mock to return success by default
    vi.mocked(execC).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any)
  })

  it('should clean up old WordPress update branches', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'master', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({
        stdout: '  joltWpUpdate/2023-10-01\n  joltWpUpdate/2023-10-02',
        stderr: '',
        exitCode: 0,
      } as any) // branch list (only 2 branches, excluding current)
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // first branch deletion
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // second branch deletion

    command.dryRun = false
    command.deleteUnmerged = true // Use -D flag for this test
    const result = await command.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledWith('git', ['branch', '--show-current'], expect.any(Object))
    expect(execC).toHaveBeenCalledWith('git', ['branch', '--list', 'joltWpUpdate/*'], expect.any(Object))
    expect(execC).toHaveBeenCalledWith('git', ['branch', '-D', 'joltWpUpdate/2023-10-01'], { reject: false })
    expect(execC).toHaveBeenCalledWith('git', ['branch', '-D', 'joltWpUpdate/2023-10-02'], { reject: false })
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Successfully deleted 2 branches'))
  })

  it('should handle case when no branches to clean', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'master', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // empty branch list

    const result = await command.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledTimes(2)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('No WordPress update branches found to clean'),
    )
  })

  it('should not delete current branch if it is an update branch', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'joltWpUpdate/2023-10-03', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({
        stdout: '  joltWpUpdate/2023-10-01\n  joltWpUpdate/2023-10-02\n* joltWpUpdate/2023-10-03',
        stderr: '',
        exitCode: 0,
      } as any) // branch list
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // first branch deletion
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // second branch deletion

    command.dryRun = false
    command.deleteUnmerged = true // Use -D flag for this test
    const result = await command.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledWith('git', ['branch', '-D', 'joltWpUpdate/2023-10-01'], { reject: false })
    expect(execC).toHaveBeenCalledWith('git', ['branch', '-D', 'joltWpUpdate/2023-10-02'], { reject: false })
    // Should not delete the current branch
    expect(execC).not.toHaveBeenCalledWith('git', ['branch', '-D', 'joltWpUpdate/2023-10-03'], expect.any(Object))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Successfully deleted 2 branches'))
  })

  it('should handle error when listing branches fails', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'master', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({ stdout: '', stderr: 'Error', exitCode: 1 } as any) // failed branch list

    const result = await command.command()

    expect(result).toBe(1)
    expect(mockContext.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Failed to list branches'))
  })

  it('should return error when WordPress config fails to load', async () => {
    vi.spyOn(mockConfig, 'loadWordPressConfig').mockResolvedValue(null)

    const result = await command.command()

    expect(result).toBe(1)
    expect(mockContext.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load WordPress configuration'),
    )
  })

  it('should skip current branch if on an update branch but still delete others', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'joltWpUpdate/current', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({
        stdout: '  joltWpUpdate/old1\n* joltWpUpdate/current\n  joltWpUpdate/old2',
        stderr: '',
        exitCode: 0,
      } as any) // branch list
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // first branch deletion
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // second branch deletion

    command.dryRun = false
    command.deleteUnmerged = true // Use -D flag for this test
    const result = await command.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledWith('git', ['branch', '-D', 'joltWpUpdate/old1'], { reject: false })
    expect(execC).toHaveBeenCalledWith('git', ['branch', '-D', 'joltWpUpdate/old2'], { reject: false })
    expect(execC).not.toHaveBeenCalledWith('git', ['branch', '-D', 'joltWpUpdate/current'], { reject: false })
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Successfully deleted 2 branches'))
  })

  it('should show what would be deleted in dry-run mode', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'master', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({
        stdout: '  joltWpUpdate/2023-10-01\n  joltWpUpdate/2023-10-02',
        stderr: '',
        exitCode: 0,
      } as any) // branch list

    command.dryRun = true
    command.deleteUnmerged = true // This test should use force delete mode
    const result = await command.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledWith('git', ['branch', '--show-current'], expect.any(Object))
    expect(execC).toHaveBeenCalledWith('git', ['branch', '--list', 'joltWpUpdate/*'], expect.any(Object))
    // Should NOT call git branch -D in dry-run mode
    expect(execC).not.toHaveBeenCalledWith('git', ['branch', '-D', expect.any(String)], expect.any(Object))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('Would force delete joltWpUpdate/2023-10-01'),
    )
    expect(mockContext.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('Would force delete joltWpUpdate/2023-10-02'),
    )
    expect(mockContext.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('Dry run complete. Would process 2 WordPress update branches'),
    )
  })

  it('should show dry-run in title when dry-run is enabled', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'master', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // empty branch list

    command.dryRun = true
    const result = await command.command()

    expect(result).toBe(0)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('WordPress Update Branch Cleanup (Dry Run)'),
    )
  })

  it('should use -d flag by default to only delete merged branches', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'master', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({
        stdout: '  joltWpUpdate/2023-10-01',
        stderr: '',
        exitCode: 0,
      } as any) // branch list
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // branch deletion

    command.dryRun = false
    command.deleteUnmerged = false
    const result = await command.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledWith('git', ['branch', '-d', 'joltWpUpdate/2023-10-01'], { reject: false })
  })

  it('should use -D flag when --delete-unmerged is enabled', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'master', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({
        stdout: '  joltWpUpdate/2023-10-01',
        stderr: '',
        exitCode: 0,
      } as any) // branch list
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // branch deletion

    command.dryRun = false
    command.deleteUnmerged = true
    const result = await command.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledWith('git', ['branch', '-D', 'joltWpUpdate/2023-10-01'], { reject: false })
  })

  it('should handle unmerged branches gracefully when not using --delete-unmerged', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'master', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({
        stdout: '  joltWpUpdate/2023-10-01',
        stderr: '',
        exitCode: 0,
      } as any) // branch list
      .mockResolvedValueOnce({
        stdout: '',
        stderr: "error: The branch 'joltWpUpdate/2023-10-01' is not fully merged.",
        exitCode: 1,
      } as any) // branch deletion fails due to unmerged

    command.dryRun = false
    command.deleteUnmerged = false
    const result = await command.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledWith('git', ['branch', '-d', 'joltWpUpdate/2023-10-01'], { reject: false })
    expect(mockContext.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('Skipped joltWpUpdate/2023-10-01 (unmerged - use --delete-unmerged to force)'),
    )
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('skipped 1 unmerged branch'))
  })

  it('should show correct mode in dry-run with delete-unmerged', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'master', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({
        stdout: '  joltWpUpdate/2023-10-01',
        stderr: '',
        exitCode: 0,
      } as any) // branch list

    command.dryRun = true
    command.deleteUnmerged = true
    const result = await command.command()

    expect(result).toBe(0)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('Would force delete joltWpUpdate/2023-10-01'),
    )
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('(including unmerged branches)'))
  })

  it('should show correct mode in dry-run without delete-unmerged', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'master', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({
        stdout: '  joltWpUpdate/2023-10-01',
        stderr: '',
        exitCode: 0,
      } as any) // branch list

    command.dryRun = true
    command.deleteUnmerged = false
    const result = await command.command()

    expect(result).toBe(0)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('Would delete merged joltWpUpdate/2023-10-01'),
    )
    expect(mockContext.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('(merged branches only, unmerged will be skipped)'),
    )
  })
})

describe('WPUpdateModifyCommand', () => {
  let command: any
  let mockConfig: Config
  let mockContext: {
    stderr: { write: Mock }
    stdin: any
    stdout: { write: Mock }
    env: any
    colorDepth: number
  }

  beforeEach(async () => {
    vi.clearAllMocks()

    mockContext = {
      stderr: { write: vi.fn() },
      stdin: {},
      stdout: { write: vi.fn() },
      env: {},
      colorDepth: 256,
    }

    mockConfig = new Config(mockContext)
    vi.spyOn(mockConfig, 'loadWordPressConfig').mockResolvedValue({})
    vi.spyOn(mockConfig, 'get').mockResolvedValue('master')
    vi.spyOn(mockConfig, 'command').mockResolvedValue('git')

    const { WPUpdateModifyCommand } = await import('../../src/Command/WP.js')
    command = new WPUpdateModifyCommand()
    command.config = mockConfig
    command.context = mockContext
    command.logo = '⚡'

    // Reset execC mock to return success by default
    vi.mocked(execC).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any)
  })

  it('should perform interactive rebase when on update branch with commits', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'joltWpUpdate/2023-10-01', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({ stdout: '3', stderr: '', exitCode: 0 } as any) // commit count
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // interactive rebase

    const result = await command.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledTimes(3)
    expect(execC).toHaveBeenCalledWith('git', ['branch', '--show-current'], expect.any(Object))
    expect(execC).toHaveBeenCalledWith('git', ['rev-list', '--count', 'master..HEAD'], expect.any(Object))
    expect(execC).toHaveBeenCalledWith('git', ['rebase', '-i', 'HEAD~3'], expect.any(Object))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('WordPress Update Interactive Rebase'),
    )
  })

  it('should handle case when no commits to rebase', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'joltWpUpdate/2023-10-01', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({ stdout: '0', stderr: '', exitCode: 0 } as any) // no commits

    const result = await command.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledTimes(2)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('No commits to rebase'))
  })

  it('should fail if not on WordPress update branch', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC).mockResolvedValueOnce({ stdout: 'master', stderr: '', exitCode: 0 } as any) // current branch

    const result = await command.command()

    expect(result).toBe(1)
    expect(mockContext.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Not currently on a WordPress update branch'),
    )
  })

  it('should return error when WordPress config fails to load', async () => {
    vi.spyOn(mockConfig, 'loadWordPressConfig').mockResolvedValue(null)

    const result = await command.command()

    expect(result).toBe(1)
    expect(mockContext.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load WordPress configuration'),
    )
  })

  it('should handle error when getting commit count fails', async () => {
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'joltWpUpdate/2023-10-01', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({ stdout: '', stderr: 'Error', exitCode: 1 } as any) // failed commit count

    const result = await command.command()

    expect(result).toBe(1)
    expect(mockContext.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Could not determine commit count'))
  })

  it('should use correct branch name from config', async () => {
    vi.spyOn(mockConfig, 'get').mockResolvedValue('main')
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'joltWpUpdate/2023-10-01', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({ stdout: '2', stderr: '', exitCode: 0 } as any) // commit count

    const result = await command.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledWith('git', ['rev-list', '--count', 'main..HEAD'], expect.any(Object))
  })
})

describe('WPUpdateCommand', () => {
  let command: any
  let mockConfig: Config
  let mockContext: {
    stderr: { write: Mock }
    stdin: any
    stdout: { write: Mock }
    env: any
    colorDepth: number
  }

  beforeEach(async () => {
    vi.clearAllMocks()

    mockContext = {
      stderr: { write: vi.fn() },
      stdin: {},
      stdout: { write: vi.fn() },
      env: {},
      colorDepth: 256,
    }

    mockConfig = new Config(mockContext)
    vi.spyOn(mockConfig, 'loadWordPressConfig').mockResolvedValue({
      doNotUpdate: [],
      pluginFolder: 'wp-content/plugins',
      themeFolder: 'wp-content/themes',
      wpRoot: 'wp',
    })
    vi.spyOn(mockConfig, 'get').mockResolvedValue('master')
    vi.spyOn(mockConfig, 'command').mockResolvedValue('yarn')

    const { WPUpdateCommand } = await import('../../src/Command/WP.js')
    command = new WPUpdateCommand()
    command.config = mockConfig
    command.context = mockContext
    command.logo = '⚡'

    // Set default option values
    command.skipCore = false
    command.skipPlugins = false
    command.skipThemes = false

    // Reset execC mock to return success by default
    vi.mocked(execC).mockResolvedValue({ stdout: '[]', stderr: '', exitCode: 0 } as any)
  })

  it('should complete successfully when no updates available', async () => {
    const result = await command.command()

    expect(result).toBe(0)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('WordPress Updates'))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('No updates available'))
  })

  it('should skip components when flags are set', async () => {
    command.skipPlugins = true
    command.skipThemes = true
    command.skipCore = true

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('WordPress Updates'))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('No updates available'))
  })

  it('should return error when WordPress config fails to load', async () => {
    vi.spyOn(mockConfig, 'loadWordPressConfig').mockResolvedValue(null)

    const result = await command.command()

    expect(result).toBe(1)
    expect(mockContext.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load WordPress configuration'),
    )
  })

  it('should handle plugin updates with branch creation', async () => {
    // Mock the private methods to simulate successful plugin updates
    vi.spyOn(command, 'parsePluginJson').mockReturnValue([
      { name: 'test-plugin', status: 'active', update: 'available', version: '1.0.0', title: 'Test Plugin' },
    ])
    vi.spyOn(command, 'maybeUpdatePlugin').mockImplementation(async (_plugin, _config, branchRef: any) => {
      // Simulate branch creation and successful update
      branchRef.branch = 'joltWpUpdate/test-branch'
      branchRef.created = true
      return true
    })
    vi.spyOn(command, 'parseThemeJson').mockReturnValue([])
    vi.spyOn(command, 'hasCoreUpdate').mockResolvedValue(false)

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Updated 1 plugins'))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Next steps:'))
  })

  it('should handle theme updates with branch creation', async () => {
    command.skipPlugins = true

    // Mock the private methods to simulate successful theme updates
    vi.spyOn(command, 'parseThemeJson').mockReturnValue([
      { name: 'test-theme', status: 'active', update: 'available', version: '1.0.0', title: 'Test Theme' },
    ])
    vi.spyOn(command, 'maybeUpdateTheme').mockImplementation(async (_theme, _config, branchRef: any) => {
      // Simulate branch creation and successful update
      branchRef.branch = 'joltWpUpdate/test-branch'
      branchRef.created = true
      return true
    })
    vi.spyOn(command, 'hasCoreUpdate').mockResolvedValue(false)

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Updated 1 themes'))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Next steps:'))
  })

  it('should skip plugins/themes in doNotUpdate list', async () => {
    vi.spyOn(mockConfig, 'loadWordPressConfig').mockResolvedValue({
      doNotUpdate: ['skip-plugin', 'skip-theme'],
      pluginFolder: 'wp-content/plugins',
      themeFolder: 'wp-content/themes',
      wpRoot: 'wp',
    })

    // Mock items that should be skipped
    vi.spyOn(command, 'parsePluginJson').mockReturnValue([
      { name: 'skip-plugin', status: 'active', update: 'available', version: '1.0.0', title: 'Skip Plugin' },
    ])
    vi.spyOn(command, 'parseThemeJson').mockReturnValue([
      { name: 'skip-theme', status: 'active', update: 'available', version: '1.0.0', title: 'Skip Theme' },
    ])
    vi.spyOn(command, 'hasCoreUpdate').mockResolvedValue(false)

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Skipping skip-plugin'))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Skipping skip-theme'))
  })

  it('should handle core updates', async () => {
    command.skipPlugins = true
    command.skipThemes = true

    // Mock successful core update
    vi.spyOn(command, 'hasCoreUpdate').mockResolvedValue('6.3.2')
    vi.spyOn(command, 'maybeUpdateCore').mockResolvedValue(true)
    vi.spyOn(command, 'createBranch').mockResolvedValue('joltWpUpdate/test-branch')

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Updated WordPress core'))
  })

  it('should show next steps when updates are made', async () => {
    command.skipThemes = true
    command.skipCore = true

    // Mock successful plugin update
    vi.spyOn(command, 'parsePluginJson').mockReturnValue([
      { name: 'test-plugin', status: 'active', update: 'available', version: '1.0.0', title: 'Test Plugin' },
    ])
    vi.spyOn(command, 'maybeUpdatePlugin').mockImplementation(async (_plugin, _config, branchRef: any) => {
      // Simulate branch creation and successful update
      branchRef.branch = 'joltWpUpdate/test-branch'
      branchRef.created = true
      return true
    })

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Next steps:'))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('jolt wp update modify'))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('jolt wp update merge'))
  })
})
