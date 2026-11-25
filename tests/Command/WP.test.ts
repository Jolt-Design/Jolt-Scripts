import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { WPCLICommand, WPCommand } from '../../src/Command/WP.js'
import { Config } from '../../src/Config.js'
import { execC, fileExists, which } from '../../src/utils.js'

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
    command.autostash = false // Explicitly set to false to test default behavior
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'joltWpUpdate/2023-10-01', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({ stdout: '3', stderr: '', exitCode: 0 } as any) // commit count
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // interactive rebase

    const result = await command.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledTimes(3)
    expect(execC).toHaveBeenCalledWith('git', ['branch', '--show-current'])
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

  it('should add --autostash flag when autostash option is enabled', async () => {
    command.autostash = true
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'joltWpUpdate/2023-10-01', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({ stdout: '3', stderr: '', exitCode: 0 } as any) // commit count
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // interactive rebase

    const result = await command.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledWith('git', ['rebase', '-i', 'HEAD~3', '--autostash'], expect.any(Object))
  })

  it('should not add --autostash flag when autostash option is disabled', async () => {
    command.autostash = false
    vi.mocked(execC).mockClear()
    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: 'joltWpUpdate/2023-10-01', stderr: '', exitCode: 0 } as any) // current branch
      .mockResolvedValueOnce({ stdout: '3', stderr: '', exitCode: 0 } as any) // commit count
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // interactive rebase

    const result = await command.command()

    expect(result).toBe(0)
    expect(execC).toHaveBeenCalledWith('git', ['rebase', '-i', 'HEAD~3'], expect.any(Object))
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
    command.skipLanguages = false

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

  it('should skip language updates when --skip-languages flag is set', async () => {
    command.skipLanguages = true

    // Mock that we have some updates to ensure translations would normally run
    vi.spyOn(command, 'processItemUpdates').mockImplementation(
      async (type: any, skip: any, _config: any, branchRef: any) => {
        if (type === 'plugin' && !skip) {
          branchRef.branch = 'joltWpUpdate/test-branch'
          branchRef.created = true
          return {
            count: 1,
            details: [{ name: 'test-plugin', title: 'Test Plugin', fromVersion: '1.0.0', toVersion: '1.1.0' }],
          }
        }
        return { count: 0, details: [] }
      },
    )
    vi.spyOn(command, 'hasCoreUpdate').mockResolvedValue(false)

    // Spy on maybeUpdateTranslations to ensure it's not called
    const translationsSpy = vi.spyOn(command, 'maybeUpdateTranslations')

    const result = await command.command()

    expect(result).toBe(0)
    expect(translationsSpy).not.toHaveBeenCalled()
    expect(mockContext.stdout.write).not.toHaveBeenCalledWith(expect.stringContaining('Updating translations'))
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
    vi.spyOn(command, 'processItemUpdates').mockImplementation(
      async (type: any, skip: any, _config: any, branchRef: any) => {
        if (type === 'plugin' && !skip) {
          // Simulate branch creation and successful update
          branchRef.branch = 'joltWpUpdate/test-branch'
          branchRef.created = true
          return {
            count: 1,
            details: [
              {
                name: 'test-plugin',
                title: 'Test Plugin',
                fromVersion: '1.0.0',
                toVersion: '1.1.0',
              },
            ],
          }
        }
        return { count: 0, details: [] }
      },
    )
    vi.spyOn(command, 'hasCoreUpdate').mockResolvedValue(false)

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Updated 1 plugins'))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Next steps:'))
  })

  it('should handle theme updates with branch creation', async () => {
    command.skipPlugins = true

    // Mock the private methods to simulate successful theme updates
    vi.spyOn(command, 'processItemUpdates').mockImplementation(
      async (type: any, skip: any, _config: any, branchRef: any) => {
        if (type === 'theme' && !skip) {
          // Simulate branch creation and successful update
          branchRef.branch = 'joltWpUpdate/test-branch'
          branchRef.created = true
          return {
            count: 1,
            details: [
              {
                name: 'test-theme',
                title: 'Test Theme',
                fromVersion: '1.0.0',
                toVersion: '1.1.0',
              },
            ],
          }
        }
        return { count: 0, details: [] }
      },
    )
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

    // Mock the new methods to simulate skip behavior
    vi.spyOn(command, 'getItems').mockImplementation(async (type: any) => {
      if (type === 'plugin') {
        return [{ name: 'skip-plugin', status: 'active', update: 'available', version: '1.0.0', title: 'Skip Plugin' }]
      }
      if (type === 'theme') {
        return [{ name: 'skip-theme', status: 'active', update: 'available', version: '1.0.0', title: 'Skip Theme' }]
      }
      return []
    })

    // Mock maybeUpdateItem to simulate skip behavior based on doNotUpdate list
    vi.spyOn(command, 'maybeUpdateItem').mockImplementation(async (item: any, wpConfig: any) => {
      if (wpConfig.doNotUpdate.includes(item.name)) {
        command.context.stdout.write(`  Skipping ${item.name} (configured to skip)\n`)
        return { updated: false }
      }
      return { updated: false }
    })

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
    vi.spyOn(command, 'maybeUpdateCore').mockResolvedValue({
      updated: true,
      details: {
        fromVersion: '6.3.1',
        toVersion: '6.3.2',
      },
    })
    vi.spyOn(command, 'createBranch').mockResolvedValue('joltWpUpdate/test-branch')

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Updated WordPress core'))
  })

  describe('hasCoreUpdate', () => {
    it('should return the newest version when check-update lists a minor release before a major one', async () => {
      vi.spyOn(command, 'executeWpCli').mockResolvedValue({
        exitCode: 0,
        stdout:
          '[{"version":"7.0.9","update_type":"minor","package_url":"a"},{"version":"7.1.5","update_type":"major","package_url":"b"}]',
      })

      expect(await command.hasCoreUpdate()).toBe('7.1.5')
    })

    it('should compare version parts numerically', async () => {
      vi.spyOn(command, 'executeWpCli').mockResolvedValue({
        exitCode: 0,
        stdout: '[{"version":"7.10"},{"version":"7.9.1"}]',
      })

      expect(await command.hasCoreUpdate()).toBe('7.10')
    })

    it('should return false when there are no updates', async () => {
      vi.spyOn(command, 'executeWpCli').mockResolvedValue({ exitCode: 0, stdout: '[]' })

      expect(await command.hasCoreUpdate()).toBe(false)
    })
  })

  it('should only stash changes inside the WordPress root during a core update', async () => {
    vi.spyOn(mockConfig, 'command').mockResolvedValue('git')
    vi.spyOn(command, 'hasCoreUpdate').mockResolvedValue('6.3.2')
    vi.spyOn(command, 'getCurrentCoreVersion').mockResolvedValue('6.3.1')
    vi.spyOn(command, 'hasGitChanges').mockResolvedValue(true)
    vi.spyOn(command, 'doCoreUpdate').mockResolvedValue(undefined)

    const wpConfig = await mockConfig.loadWordPressConfig()
    const result = await command.maybeUpdateCore(wpConfig, { branch: undefined, created: false })

    expect(result.updated).toBe(true)

    const gitCalls = vi
      .mocked(execC)
      .mock.calls.filter(([cmd]) => cmd === 'git')
      .map(([, args]) => args)

    expect(gitCalls).toEqual([
      ['add', '--', 'wp'],
      ['stash', 'push', '-m', expect.stringContaining('Automated stash'), '--', 'wp'],
      ['stash', 'pop'],
      ['reset', 'HEAD', '--', 'wp'],
    ])
  })

  it('should show next steps when updates are made', async () => {
    command.skipThemes = true
    command.skipCore = true

    // Mock successful plugin update
    vi.spyOn(command, 'processItemUpdates').mockImplementation(
      async (type: any, skip: any, _config: any, branchRef: any) => {
        if (type === 'plugin' && !skip) {
          // Simulate branch creation and successful update
          branchRef.branch = 'joltWpUpdate/test-branch'
          branchRef.created = true
          return {
            count: 1,
            details: [
              {
                name: 'test-plugin',
                title: 'Test Plugin',
                fromVersion: '1.0.0',
                toVersion: '1.1.0',
              },
            ],
          }
        }
        return { count: 0, details: [] }
      },
    )
    vi.spyOn(command, 'maybeUpdateTranslations').mockResolvedValue(false)

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Next steps:'))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('jolt wp update modify'))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('jolt wp update merge'))
  })

  describe('core update failures', () => {
    let wpConfig: any
    let branchRef: { branch: string | undefined; created: boolean }

    beforeEach(async () => {
      vi.spyOn(mockConfig, 'command').mockResolvedValue('git')
      vi.spyOn(command, 'hasCoreUpdate').mockResolvedValue('6.3.2')
      vi.spyOn(command, 'hasGitChanges').mockResolvedValue(false)
      wpConfig = await mockConfig.loadWordPressConfig()
      branchRef = { branch: undefined, created: false }
    })

    const gitCalls = () =>
      vi
        .mocked(execC)
        .mock.calls.filter(([cmd]) => cmd === 'git')
        .map(([, args]) => args)

    it('should report a failure and not commit when wp core update exits with an error', async () => {
      vi.spyOn(command, 'getCurrentCoreVersion').mockResolvedValue('6.3.1')
      vi.spyOn(command, 'executeWpCli').mockResolvedValue({ exitCode: 1, stdout: null })

      const result = await command.maybeUpdateCore(wpConfig, branchRef)

      expect(result.updated).toBe(false)
      expect(branchRef.created).toBe(false)
      expect(gitCalls()).toEqual([])
      expect(mockContext.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('WordPress core update failed: wp core update exited with code 1'),
      )
    })

    it('should report a failure and not commit when the core version did not change', async () => {
      vi.spyOn(command, 'getCurrentCoreVersion').mockResolvedValue('6.3.1')
      vi.spyOn(command, 'executeWpCli').mockResolvedValue({ exitCode: 0, stdout: '' })

      const result = await command.maybeUpdateCore(wpConfig, branchRef)

      expect(result.updated).toBe(false)
      expect(gitCalls()).toEqual([])
      expect(mockContext.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('expected version 6.3.2 but found 6.3.1'),
      )
    })

    it('should commit when the core version matches after the update', async () => {
      vi.spyOn(command, 'getCurrentCoreVersion')
        .mockResolvedValueOnce('6.3.1')
        .mockResolvedValueOnce('$ jolt wp cli core version\n6.3.2')
      vi.spyOn(command, 'executeWpCli').mockResolvedValue({ exitCode: 0, stdout: '' })
      vi.spyOn(command, 'createBranch').mockResolvedValue('joltWpUpdate/test-branch')
      vi.mocked(execC).mockImplementation((async (_cmd: string, args: string[]) => ({
        stdout: args[0] === 'ls-files' ? 'wp/wp-admin/new.php\0wp/wp-content/themes/twentytwentysix/style.css\0' : '',
        exitCode: 0,
      })) as any)

      const result = await command.maybeUpdateCore(wpConfig, branchRef)

      expect(result).toEqual({ updated: true, details: { fromVersion: '6.3.1', toVersion: '6.3.2' } })
      expect(gitCalls()).toEqual([
        ['add', '-u', '--', 'wp'],
        [
          'ls-files',
          '--others',
          '--exclude-standard',
          '-z',
          '--',
          'wp/wp-admin',
          'wp/wp-includes',
          ':(glob)wp/wp-content/themes/twenty*/**',
        ],
        ['add', '--', 'wp/wp-admin/new.php', 'wp/wp-content/themes/twentytwentysix/style.css'],
        ['commit', '-m', 'Update WordPress to 6.3.2'],
      ])
    })

    it('should not run git add for new files when there are none', async () => {
      vi.spyOn(command, 'getCurrentCoreVersion').mockResolvedValueOnce('6.3.1').mockResolvedValueOnce('6.3.2')
      vi.spyOn(command, 'executeWpCli').mockResolvedValue({ exitCode: 0, stdout: '' })
      vi.spyOn(command, 'createBranch').mockResolvedValue('joltWpUpdate/test-branch')
      vi.mocked(execC).mockImplementation((async () => ({ stdout: '', exitCode: 0 })) as any)

      await command.maybeUpdateCore(wpConfig, branchRef)

      expect(gitCalls().map(([subcommand]) => subcommand)).toEqual(['add', 'ls-files', 'commit'])
    })
  })

  it('should overwrite Redis dropin and stage it when redis-cache plugin is updated', async () => {
    // Prepare command instance
    vi.mocked(execC).mockClear()

    // Mock getDetails to return older then newer version
    vi.spyOn(command, 'getDetails')
      .mockResolvedValueOnce({ name: 'redis-cache', version: '1.0.0', title: 'Redis Object Cache' } as any)
      .mockResolvedValueOnce({ name: 'redis-cache', version: '1.1.0', title: 'Redis Object Cache' } as any)

    // Mock executeWpCli for the plugin update command
    vi.spyOn(command, 'executeWpCli').mockResolvedValue({ exitCode: 0, stdout: '' } as any)

    // Mock filesystem to indicate plugin provides object-cache.php
    const fs = await import('node:fs')
    vi.spyOn(fs.promises, 'stat').mockImplementation(async (_p: any) => {
      return {} as any
    })
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('<?php // Redis Object Cache ?>'))
    vi.spyOn(fs.promises, 'copyFile').mockResolvedValue()

    // Ensure git command is available
    vi.spyOn(mockConfig, 'command').mockResolvedValue('git')

    // Call updateItem via maybeUpdateItem
    const wpConfig = await mockConfig.loadWordPressConfig()

    const result = await command.maybeUpdateItem(
      {
        name: 'redis-cache',
        status: 'active',
        update: 'available',
        version: '1.0.0',
        title: 'Redis Object Cache',
      } as any,
      wpConfig,
      { branch: undefined, created: false },
      command.getItemConfig('plugin'),
    )

    expect(result.updated).toBe(true)

    // git add should be called - one for plugin folder and one for dropin
    expect(vi.mocked(execC)).toHaveBeenCalledWith('git', [
      'add',
      expect.stringContaining('wp-content/plugins/redis-cache'),
    ])
    expect(vi.mocked(execC)).toHaveBeenCalledWith('git', [
      'add',
      expect.stringContaining('wp-content/object-cache.php'),
    ])
  })

  describe('failed plugin updates', () => {
    const plugin = { name: 'test-plugin', status: 'active', update: 'available', version: '1.0.0', title: 'Test' }
    const location = 'wp-content/plugins/test-plugin'

    const runUpdate = async () =>
      command.maybeUpdateItem(
        plugin,
        await mockConfig.loadWordPressConfig(),
        { branch: undefined, created: false },
        command.getItemConfig('plugin'),
      )

    const gitCalls = () =>
      vi
        .mocked(execC)
        .mock.calls.filter(([cmd]) => cmd === 'git')
        .map(([, args]) => args)

    beforeEach(() => {
      vi.spyOn(mockConfig, 'command').mockResolvedValue('git')
      vi.spyOn(command, 'hasGitChanges').mockResolvedValue(false)
    })

    it('should explain an unchanged version and restore the plugin folder', async () => {
      vi.spyOn(command, 'executeWpCli')
        .mockResolvedValueOnce({ exitCode: 0, stdout: '{"name":"test-plugin","title":"Test","version":"1.0.0"}' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '{"name":"test-plugin","title":"Test","version":"1.0.0"}' })

      const result = await runUpdate()

      expect(result.updated).toBe(false)
      expect(mockContext.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('Update failed! version is still 1.0.0'),
      )
      expect(gitCalls()).toEqual([
        ['checkout', '--', location],
        ['clean', '-fd', '--', location],
      ])
    })

    it('should explain unreadable plugin details after the update', async () => {
      vi.spyOn(command, 'executeWpCli')
        .mockResolvedValueOnce({ exitCode: 0, stdout: '{"name":"test-plugin","title":"Test","version":"1.0.0"}' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'Notice: something went wrong' })

      const result = await runUpdate()

      expect(result.updated).toBe(false)
      expect(mockContext.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining("couldn't read the output of wp plugin get"),
      )
      expect(mockContext.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Notice: something went wrong'))
    })

    it('should explain when wp plugin get fails after the update', async () => {
      vi.spyOn(command, 'executeWpCli')
        .mockResolvedValueOnce({ exitCode: 0, stdout: '{"name":"test-plugin","title":"Test","version":"1.0.0"}' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '' })
        .mockResolvedValueOnce({ exitCode: 255, stdout: null })

      await runUpdate()

      expect(mockContext.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('wp plugin get exited with code 255'),
      )
    })

    it('should restore the plugin folder when the update command fails', async () => {
      vi.spyOn(command, 'executeWpCli')
        .mockResolvedValueOnce({ exitCode: 0, stdout: '{"name":"test-plugin","title":"Test","version":"1.0.0"}' })
        .mockResolvedValueOnce({ exitCode: 1, stdout: null })

      const result = await runUpdate()

      expect(result.updated).toBe(false)
      expect(gitCalls()).toEqual([
        ['checkout', '--', location],
        ['clean', '-fd', '--', location],
      ])
    })

    it('should leave the plugin folder alone if it had uncommitted changes before the update', async () => {
      vi.spyOn(command, 'hasGitChanges').mockResolvedValue(true)
      vi.spyOn(command, 'executeWpCli')
        .mockResolvedValueOnce({ exitCode: 0, stdout: '{"name":"test-plugin","title":"Test","version":"1.0.0"}' })
        .mockResolvedValueOnce({ exitCode: 1, stdout: null })

      await runUpdate()

      expect(gitCalls()).toEqual([])
      expect(mockContext.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('had uncommitted changes before the update'),
      )
    })
  })

  it('should suggest short form commands when update script exists', async () => {
    command.skipThemes = true
    command.skipCore = true

    // Mock package.json with update script shortcut
    vi.spyOn(mockConfig, 'getPackageJson').mockResolvedValue({
      scripts: {
        update: 'jolt wp update',
      },
    } as any)

    // Mock successful plugin update
    vi.spyOn(command, 'processItemUpdates').mockImplementation(
      async (type: any, skip: any, _config: any, branchRef: any) => {
        if (type === 'plugin' && !skip) {
          branchRef.branch = 'joltWpUpdate/test-branch'
          branchRef.created = true
          return {
            count: 1,
            details: [
              {
                name: 'test-plugin',
                title: 'Test Plugin',
                fromVersion: '1.0.0',
                toVersion: '1.1.0',
              },
            ],
          }
        }
        return { count: 0, details: [] }
      },
    )
    vi.spyOn(command, 'maybeUpdateTranslations').mockResolvedValue(false)

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('yarn update modify'))
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('yarn update merge'))
  })

  it('should update translations after component updates', async () => {
    command.skipPlugins = true
    command.skipThemes = true
    command.skipCore = true

    // Mock successful translation update
    vi.spyOn(command, 'maybeUpdateTranslations').mockResolvedValue(true)

    const result = await command.command()

    expect(result).toBe(0)
    expect(command.maybeUpdateTranslations).toHaveBeenCalled()
    expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Updating translations'))
  })

  it('should commit translation updates with correct message', async () => {
    command.skipPlugins = true
    command.skipThemes = true
    command.skipCore = true

    // Mock the translation update flow
    const mockTranslationResult = {
      exitCode: 0,
      stdout: 'Updated 2 translations',
      stderr: '',
    }

    vi.mocked(execC)
      .mockResolvedValueOnce({ stdout: '[]', stderr: '', exitCode: 0 } as any) // plugins list
      .mockResolvedValueOnce({ stdout: '[]', stderr: '', exitCode: 0 } as any) // themes list
      .mockResolvedValueOnce(mockTranslationResult as any) // core language update
      .mockResolvedValueOnce(mockTranslationResult as any) // plugin language update
      .mockResolvedValueOnce(mockTranslationResult as any) // theme language update
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // git add -u
      .mockResolvedValueOnce({ stdout: 'wp/wp-content/languages/a.mo\0', stderr: '', exitCode: 0 } as any) // git ls-files
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // git add new files
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 } as any) // git diff --cached (has changes)
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any) // git commit

    const result = await command.command()

    expect(result).toBe(0)

    // Verify git commit was called with correct message
    expect(vi.mocked(execC)).toHaveBeenCalledWith(
      'yarn',
      ['jolt', 'wp', 'cli', 'language', 'core', 'update'],
      expect.any(Object),
    )
    expect(vi.mocked(execC)).toHaveBeenCalledWith(
      'yarn',
      ['jolt', 'wp', 'cli', 'language', 'plugin', 'update', '--all'],
      expect.any(Object),
    )
    expect(vi.mocked(execC)).toHaveBeenCalledWith(
      'yarn',
      ['jolt', 'wp', 'cli', 'language', 'theme', 'update', '--all'],
      expect.any(Object),
    )
  })

  describe('ACF Pro license', () => {
    const header = (vars: unknown) =>
      `<?php $jolt = json_decode(base64_decode('${Buffer.from(JSON.stringify(vars)).toString('base64')}'), true); ?><?php`
    let evalInputs: string[]

    const mockWpCli = (
      prepareResult: Record<string, unknown>,
      restoreResult: Record<string, unknown> = { status: 'ok' },
    ) => {
      vi.spyOn(command, 'executeWpCli').mockImplementation(async (args: any, options: any) => {
        if (args[0] === 'eval-file') {
          evalInputs.push(options.input)
          const result = evalInputs.length === 1 ? prepareResult : restoreResult
          return { exitCode: 0, stdout: `Warning\nJOLT_RESULT:${JSON.stringify(result)}\n` }
        }

        return { exitCode: 0, stdout: '[]' }
      })
    }

    beforeEach(async () => {
      const fs = await import('node:fs')

      if (vi.isMockFunction(fs.promises.readFile)) {
        vi.mocked(fs.promises.readFile).mockRestore()
      }

      evalInputs = []
      command.skipThemes = true
      command.skipCore = true
      command.skipLanguages = true
      vi.spyOn(mockConfig, 'loadWordPressConfig').mockResolvedValue({
        doNotUpdate: [],
        pluginFolder: 'wp-content/plugins',
        themeFolder: 'wp-content/themes',
        wpRoot: 'wp',
        acfProLicense: '{ssm:/prod/test/acfKey}',
      })
      vi.mocked(fileExists).mockResolvedValue(true)
    })

    it('does nothing when ACF Pro is not installed', async () => {
      vi.mocked(fileExists).mockResolvedValue(false)
      mockWpCli({ status: 'ok', source: 'config', original: 'abc' })

      await command.command()

      expect(evalInputs).toHaveLength(0)
    })

    it('does nothing when plugin updates are skipped', async () => {
      command.skipPlugins = true
      mockWpCli({ status: 'ok', source: 'config', original: 'abc' })

      await command.command()

      expect(evalInputs).toHaveLength(0)
    })

    it('binds the configured key on stdin and restores the original option afterwards', async () => {
      vi.spyOn(mockConfig, 'parseArg').mockResolvedValue('config-key')
      mockWpCli({ status: 'ok', source: 'config', original: 'original-option' })

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockConfig.parseArg).toHaveBeenCalledWith('{ssm:/prod/test/acfKey}')
      expect(evalInputs).toHaveLength(2)
      expect(evalInputs[0].startsWith(header({ configuredKey: 'config-key' }))).toBe(true)
      expect(evalInputs[0]).toContain('acf_pro_update_license($key)')
      expect(evalInputs[1].startsWith(header({ original: 'original-option' }))).toBe(true)
      expect(evalInputs[1]).toContain("acf_pro_update_license_option('acf_pro_license', $original)")
      expect(evalInputs.join('')).not.toContain('config-key')
      expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('license key from the config'))
      expect(mockContext.stderr.write).not.toHaveBeenCalledWith(expect.stringContaining('Could not restore'))
    })

    it('reports when the key had to be activated for the site URL', async () => {
      vi.spyOn(mockConfig, 'parseArg').mockResolvedValue('config-key')
      mockWpCli({ status: 'ok', source: 'config', original: false, activation: 'activated' })

      await command.command()

      expect(evalInputs[0]).toContain('acf_pro_activate_license($key, true)')
      expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Activated the license key'))
    })

    it('warns when the key cannot be activated for the site URL', async () => {
      vi.spyOn(mockConfig, 'parseArg').mockResolvedValue('config-key')
      mockWpCli({ status: 'ok', source: 'config', original: false, activation: 'failed', message: 'Limit reached' })

      await command.command()

      expect(mockContext.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('Could not activate the ACF Pro license for this site URL: Limit reached'),
      )
      expect(evalInputs).toHaveLength(2)
    })

    it('warns when the original option cannot be restored', async () => {
      vi.spyOn(mockConfig, 'parseArg').mockResolvedValue('config-key')
      mockWpCli({ status: 'ok', source: 'config', original: 'original-option' }, { status: 'unavailable' })

      await command.command()

      expect(mockContext.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Could not restore'))
    })

    it('falls back to the database key when the placeholder cannot be resolved', async () => {
      vi.spyOn(mockConfig, 'parseArg').mockImplementation(async (value: string) => value)
      mockWpCli({ status: 'ok', source: 'database', original: false })

      await command.command()

      expect(evalInputs[0].startsWith(header({ configuredKey: null }))).toBe(true)
      expect(evalInputs[1].startsWith(header({ original: false }))).toBe(true)
      expect(mockContext.stdout.write).toHaveBeenCalledWith(expect.stringContaining("Couldn't resolve"))
    })

    it('warns and skips the restore when no key is available', async () => {
      vi.spyOn(mockConfig, 'parseArg').mockImplementation(async (value: string) => value)
      mockWpCli({ status: 'no-key' })

      await command.command()

      expect(evalInputs).toHaveLength(1)
      expect(mockContext.stderr.write).toHaveBeenCalledWith(expect.stringContaining('No ACF Pro license key found'))
    })

    it('restores the original option when the plugin updates throw', async () => {
      vi.spyOn(mockConfig, 'parseArg').mockResolvedValue('config-key')
      mockWpCli({ status: 'ok', source: 'config', original: 'original-option' })
      vi.spyOn(command, 'processItemUpdates').mockRejectedValue(new Error('boom'))

      await expect(command.command()).rejects.toThrow('boom')

      expect(evalInputs).toHaveLength(2)
    })
  })
})
