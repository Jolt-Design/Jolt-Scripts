import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import {
  NexcessDeployCommand,
  NexcessDeployLocalCommand,
  NexcessDeploySpecificCommand,
} from '../../src/Command/Nexcess.js'
import { Config } from '../../src/Config.js'
import { fileExists } from '../../src/utils.js'

vi.mock('../../src/utils.js')
vi.mock('../../src/Config.js')

describe('Nexcess Commands', () => {
  let mockConfig: Config
  let mockStdout: { write: Mock }
  let mockStderr: { write: Mock }
  let mockContext: { stdin: any; stdout: any; stderr: any }
  let mockCli: { run: Mock }

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock streams
    mockStdout = { write: vi.fn() }
    mockStderr = { write: vi.fn() }
    mockContext = {
      stdin: process.stdin,
      stdout: mockStdout,
      stderr: mockStderr,
    }

    // Create mock CLI
    mockCli = { run: vi.fn().mockResolvedValue(0) }

    // Create a mock config
    mockConfig = new Config({})

    vi.spyOn(mockConfig, 'get').mockImplementation((key: string) => {
      switch (key) {
        case 'repo':
          return Promise.resolve('git@github.com:example/repo.git')
        case 'codeSubfolder':
          return Promise.resolve('web')
        case 'liveFolder':
          return Promise.resolve('/var/www/live')
        case 'devFolder':
          return Promise.resolve('/var/www/dev')
        case 'branch':
          return Promise.resolve('main')
        case 'devBranch':
          return Promise.resolve('develop')
        case 'nexcessDeployScript':
          return Promise.resolve('bin/nexcess-deploy-script.sh')
        case 'nexcessCleanupScript':
          return Promise.resolve('bin/nexcess-cleanup.sh')
        default:
          return Promise.resolve(undefined)
      }
    })

    // Mock fileExists
    vi.mocked(fileExists).mockResolvedValue(false)

    // Mock Date to have consistent timestamps
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T10:30:45.123Z'))
  })

  describe('NexcessDeployCommand', () => {
    let command: NexcessDeployCommand

    beforeEach(() => {
      command = new NexcessDeployCommand()
      command.config = mockConfig
      // @ts-expect-error - Mocking context and cli for testing
      command.context = mockContext
      // @ts-expect-error - Mocking cli for testing
      command.cli = mockCli
      command.dev = false
    })

    describe('getRequiredConfig', () => {
      it('should require base configs plus live configs for production', () => {
        command.dev = false
        expect(command.getRequiredConfig()).toEqual(['repo', 'codeSubfolder', 'liveFolder', 'branch'])
      })

      it('should require base configs plus dev configs for development', () => {
        command.dev = true
        expect(command.getRequiredConfig()).toEqual(['repo', 'codeSubfolder', 'devFolder', 'devBranch'])
      })
    })

    describe('command execution', () => {
      it('should deploy to production with default scripts when none exist', async () => {
        vi.mocked(fileExists).mockResolvedValue(false)

        const result = await command.command()

        expect(mockStdout.write).toHaveBeenCalledWith(
          expect.stringContaining('❎ Cloning into deploy-2024-01-15_10-30-45 and deploying to /var/www/live...'),
        )

        expect(mockCli.run).toHaveBeenCalledWith([
          'ssh',
          '-T',
          '-C',
          expect.stringContaining(
            'git clone --depth=1 --single-branch --branch=main git@github.com:example/repo.git deploy-2024-01-15_10-30-45',
          ),
        ])

        expect(result).toBe(0)
      })

      it('should deploy to development when dev flag is set', async () => {
        command.dev = true
        vi.mocked(fileExists).mockResolvedValue(false)

        await command.command()

        expect(mockStdout.write).toHaveBeenCalledWith(
          expect.stringContaining('❎ Cloning into deploy-2024-01-15_10-30-45 and deploying to /var/www/dev...'),
        )

        expect(mockCli.run).toHaveBeenCalledWith([
          'ssh',
          '-T',
          '-C',
          expect.stringContaining(
            'git clone --depth=1 --single-branch --branch=develop git@github.com:example/repo.git deploy-2024-01-15_10-30-45',
          ),
        ])
      })

      it('should use deploy script when it exists', async () => {
        vi.mocked(fileExists).mockImplementation((path) => {
          return Promise.resolve(path.toString().includes('nexcess-deploy-script.sh'))
        })

        await command.command()

        const sshCommand = mockCli.run.mock.calls[0][0][3]
        expect(sshCommand).toContain(
          'sh ~/deploy-2024-01-15_10-30-45/bin/nexcess-deploy-script.sh deploy-2024-01-15_10-30-45',
        )
        expect(sshCommand).not.toContain('cp -ura')
      })

      it('should use cleanup script when deploy script does not exist but cleanup does', async () => {
        vi.mocked(fileExists).mockImplementation((path) => {
          return Promise.resolve(path.toString().includes('nexcess-cleanup.sh'))
        })

        await command.command()

        const sshCommand = mockCli.run.mock.calls[0][0][3]
        expect(sshCommand).toContain('sh ../bin/nexcess-cleanup.sh')
        expect(sshCommand).toContain('cp -ura deploy-2024-01-15_10-30-45/web/. /var/www/live')
      })

      it('should skip cleanup when no cleanup script exists', async () => {
        vi.mocked(fileExists).mockResolvedValue(false)

        await command.command()

        const sshCommand = mockCli.run.mock.calls[0][0][3]
        expect(sshCommand).toContain('echo No cleanup script found, skipping...')
        expect(sshCommand).toContain('cp -ura deploy-2024-01-15_10-30-45/web/. /var/www/live')
      })

      it('should include cache clearing commands', async () => {
        vi.mocked(fileExists).mockResolvedValue(false)

        await command.command()

        const sshCommand = mockCli.run.mock.calls[0][0][3]
        expect(sshCommand).toContain('echo Clearing site cache...')
        expect(sshCommand).toContain('(wp cache-enabler clear || true)')
      })

      it('should handle custom deploy and cleanup script paths', async () => {
        // Create a fresh mock config for this test to avoid recursion
        const customMockConfig = new Config({})
        vi.spyOn(customMockConfig, 'get').mockImplementation((key: string) => {
          switch (key) {
            case 'repo':
              return Promise.resolve('git@github.com:example/repo.git')
            case 'codeSubfolder':
              return Promise.resolve('web')
            case 'liveFolder':
              return Promise.resolve('/var/www/live')
            case 'devFolder':
              return Promise.resolve('/var/www/dev')
            case 'branch':
              return Promise.resolve('main')
            case 'devBranch':
              return Promise.resolve('develop')
            case 'nexcessDeployScript':
              return Promise.resolve('custom/deploy.sh')
            case 'nexcessCleanupScript':
              return Promise.resolve('custom/cleanup.sh')
            default:
              return Promise.resolve(undefined)
          }
        })

        command.config = customMockConfig

        vi.mocked(fileExists).mockImplementation((path) => {
          return Promise.resolve(path.toString().includes('custom/deploy.sh'))
        })

        await command.command()

        const sshCommand = mockCli.run.mock.calls[0][0][3]
        expect(sshCommand).toContain('sh ~/deploy-2024-01-15_10-30-45/custom/deploy.sh deploy-2024-01-15_10-30-45')
      })
    })
  })

  describe('NexcessDeploySpecificCommand', () => {
    let command: NexcessDeploySpecificCommand

    beforeEach(() => {
      command = new NexcessDeploySpecificCommand()
      command.config = mockConfig
      // @ts-expect-error - Mocking context and cli for testing
      command.context = mockContext
      // @ts-expect-error - Mocking cli for testing
      command.cli = mockCli
      command.dev = false
      command.commit = 'abc123def456'
    })

    describe('getRequiredConfig', () => {
      it('should require base configs plus live configs for production', () => {
        command.dev = false
        expect(command.getRequiredConfig()).toEqual(['repo', 'codeSubfolder', 'liveFolder'])
      })

      it('should require base configs plus dev configs for development', () => {
        command.dev = true
        expect(command.getRequiredConfig()).toEqual(['repo', 'codeSubfolder', 'devFolder'])
      })
    })

    describe('command execution', () => {
      it('should return error when commit is not provided', async () => {
        command.commit = ''

        const result = await command.command()

        expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('⚡ Commit parameter must be specified'))
        expect(result).toBe(2)
      })

      it('should deploy specific commit to production', async () => {
        vi.mocked(fileExists).mockResolvedValue(false)

        const result = await command.command()

        expect(mockStdout.write).toHaveBeenCalledWith(
          expect.stringContaining(
            '⚡ Cloning commit abc123def456 into deploy-2024-01-15_10-30-45-abc123de and deploying to /var/www/live...',
          ),
        )

        expect(mockCli.run).toHaveBeenCalledWith([
          'ssh',
          '-T',
          '-C',
          expect.stringContaining(
            'git clone --depth=1 git@github.com:example/repo.git deploy-2024-01-15_10-30-45-abc123de',
          ),
        ])

        const sshCommand = mockCli.run.mock.calls[0][0][3]
        expect(sshCommand).toContain('git checkout abc123def456')
        expect(result).toBe(0)
      })

      it('should deploy specific commit to development when dev flag is set', async () => {
        command.dev = true
        vi.mocked(fileExists).mockResolvedValue(false)

        await command.command()

        expect(mockStdout.write).toHaveBeenCalledWith(
          expect.stringContaining(
            '⚡ Cloning commit abc123def456 into deploy-2024-01-15_10-30-45-abc123de and deploying to /var/www/dev...',
          ),
        )
      })

      it('should use deploy script when it exists for specific commit', async () => {
        vi.mocked(fileExists).mockImplementation((path) => {
          return Promise.resolve(path.toString().includes('nexcess-deploy-script.sh'))
        })

        await command.command()

        const sshCommand = mockCli.run.mock.calls[0][0][3]
        expect(sshCommand).toContain(
          'sh ~/deploy-2024-01-15_10-30-45-abc123de/bin/nexcess-deploy-script.sh deploy-2024-01-15_10-30-45-abc123de',
        )
      })

      it('should use cleanup script when deploy script does not exist but cleanup does', async () => {
        vi.mocked(fileExists).mockImplementation((path) => {
          return Promise.resolve(path.toString().includes('nexcess-cleanup.sh'))
        })

        await command.command()

        const sshCommand = mockCli.run.mock.calls[0][0][3]
        expect(sshCommand).toContain('sh ../bin/nexcess-cleanup.sh')
        expect(sshCommand).toContain('cp -ura deploy-2024-01-15_10-30-45-abc123de/web/. /var/www/live')
      })

      it('should handle short commits correctly', async () => {
        command.commit = 'abc'
        vi.mocked(fileExists).mockResolvedValue(false)

        await command.command()

        expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('deploy-2024-01-15_10-30-45-abc'))
      })
    })
  })

  describe('NexcessDeployLocalCommand', () => {
    let command: NexcessDeployLocalCommand

    beforeEach(() => {
      command = new NexcessDeployLocalCommand()
      command.config = mockConfig
      // @ts-expect-error - Mocking cli for testing
      command.cli = mockCli
      command.dev = false
      command.dryRun = false
    })

    describe('command execution', () => {
      it('should execute rsync with basic options', async () => {
        vi.mocked(fileExists).mockResolvedValue(false)

        const result = await command.command()

        expect(mockCli.run).toHaveBeenCalledWith(['rsync', './web/', '{arg:acc}:~/{arg:contentFolder}'])
        expect(result).toBe(0)
      })

      it('should include dev flag when dev is true', async () => {
        command.dev = true
        vi.mocked(fileExists).mockResolvedValue(false)

        await command.command()

        expect(mockCli.run).toHaveBeenCalledWith(['rsync', '--dev', './web/', '{arg:acc}:~/{arg:contentFolder}'])
      })

      it('should include dry-run flag when dryRun is true', async () => {
        command.dryRun = true
        vi.mocked(fileExists).mockResolvedValue(false)

        await command.command()

        expect(mockCli.run).toHaveBeenCalledWith(['rsync', '--dry-run', './web/', '{arg:acc}:~/{arg:contentFolder}'])
      })

      it('should include exclude file when .rsyncignore exists', async () => {
        vi.mocked(fileExists).mockImplementation((path) => {
          return Promise.resolve(path.toString() === '.rsyncignore')
        })

        await command.command()

        expect(mockCli.run).toHaveBeenCalledWith([
          'rsync',
          '--exclude-from=.rsyncignore',
          './web/',
          '{arg:acc}:~/{arg:contentFolder}',
        ])
      })

      it('should combine all flags when enabled', async () => {
        command.dev = true
        command.dryRun = true
        vi.mocked(fileExists).mockImplementation((path) => {
          return Promise.resolve(path.toString() === '.rsyncignore')
        })

        await command.command()

        expect(mockCli.run).toHaveBeenCalledWith([
          'rsync',
          '--dev',
          '--dry-run',
          '--exclude-from=.rsyncignore',
          './web/',
          '{arg:acc}:~/{arg:contentFolder}',
        ])
      })

      it('should use custom code subfolder from config', async () => {
        const customMockConfig = new Config({})
        vi.spyOn(customMockConfig, 'get').mockImplementation((key: string) => {
          if (key === 'codeSubfolder') {
            return Promise.resolve('public')
          }

          return Promise.resolve(undefined)
        })
        command.config = customMockConfig
        vi.mocked(fileExists).mockResolvedValue(false)

        await command.command()

        expect(mockCli.run).toHaveBeenCalledWith(['rsync', './public/', '{arg:acc}:~/{arg:contentFolder}'])
      })
    })

    describe('required commands', () => {
      it('should require rsync and ssh commands', () => {
        expect(command.requiredCommands).toEqual(['rsync', 'ssh'])
      })
    })

    describe('required config', () => {
      it('should require codeSubfolder config', () => {
        expect(command.requiredConfig).toEqual(['codeSubfolder'])
      })
    })
  })
})
