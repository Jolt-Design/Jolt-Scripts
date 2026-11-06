import { createReadStream, createWriteStream, statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { execa } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DBDumpCommand, DBResetCommand } from '../../src/Command/DB.js'
import type { Config } from '../../src/Config.js'
import { execC, which } from '../../src/utils.js'

vi.mock('../../src/utils.js', () => ({
  execC: vi.fn(),
  which: vi.fn(),
  delay: vi.fn(),
}))

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

// Mock the Node.js modules with factories to avoid hoisting issues
vi.mock('node:zlib', () => ({
  createGzip: vi.fn(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual: object = await importOriginal()
  return {
    ...actual,
    createReadStream: vi.fn(),
    createWriteStream: vi.fn(),
    statSync: vi.fn(),
  }
})

vi.mock('node:fs/promises', () => ({
  unlink: vi.fn(),
}))

vi.mock('node:stream/promises', () => ({
  pipeline: vi.fn(),
}))

describe('DBDumpCommand', () => {
  let command: DBDumpCommand
  let mockConfig: {
    get: ReturnType<typeof vi.fn>
    getComposeCommand: ReturnType<typeof vi.fn>
    getDBContainerInfo: ReturnType<typeof vi.fn>
  }
  let mockStderr: { write: ReturnType<typeof vi.fn> }
  let mockStdout: { write: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    vi.clearAllMocks()

    // Setup stream mocks
    mockStderr = { write: vi.fn() }
    mockStdout = { write: vi.fn() }

    // Create mock config
    mockConfig = {
      get: vi.fn(),
      getComposeCommand: vi.fn(),
      getDBContainerInfo: vi.fn(),
    }

    // Create command instance
    command = new DBDumpCommand()
    command.config = mockConfig as unknown as Config
    command.context = {
      stderr: mockStderr,
      stdout: mockStdout,
    } as any

    // Reset backup flag to default
    command.backup = false

    // Mock execa to return successful result
    vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any)

    // Setup Node.js module mocks
    vi.mocked(pipeline).mockResolvedValue(undefined)
    vi.mocked(createGzip).mockReturnValue('gzip-stream' as any)
    vi.mocked(createReadStream).mockReturnValue('read-stream' as any)
    vi.mocked(createWriteStream).mockReturnValue('write-stream' as any)
    vi.mocked(unlink).mockResolvedValue(undefined)

    // Mock statSync for progress monitoring
    vi.mocked(statSync).mockReturnValue({ size: 1024 } as any)

    // Mock execC for database size queries - default to failure so tests don't expect db size queries
    vi.mocked(execC).mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', failed: true } as any)
  })

  it('should use external gzip when available', async () => {
    // Explicitly set backup to false
    command.backup = false

    // Mock gzip being available
    vi.mocked(which).mockResolvedValue('/usr/bin/gzip')

    vi.mocked(mockConfig.get).mockImplementation((key: string) => {
      if (key === 'dbSeed') {
        return Promise.resolve('test.sql.gz')
      }

      return Promise.resolve('mock-value')
    })

    vi.mocked(mockConfig.getComposeCommand).mockResolvedValue(['docker', ['compose']])
    vi.mocked(mockConfig.getDBContainerInfo).mockResolvedValue({
      name: 'test-db',
      dumpCommand: 'mysqldump',
      cliCommand: 'mysql',
      adminCommand: 'mysqladmin',
      type: 'mysql' as const,
      credentials: { user: 'root', pass: 'password', db: 'testdb' },
      service: {},
    })

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Gzipping file...'))
    expect(mockStderr.write).not.toHaveBeenCalledWith(expect.stringContaining('Node zlib'))
    expect(which).toHaveBeenCalledWith('gzip')
  })

  it('should fallback to Node zlib when gzip is not available', async () => {
    // Explicitly set backup to false
    command.backup = false

    // Mock gzip not being available
    vi.mocked(which).mockResolvedValue(null)

    vi.mocked(mockConfig.get).mockImplementation((key: string) => {
      if (key === 'dbSeed') {
        return Promise.resolve('test.sql.gz')
      }

      return Promise.resolve('mock-value')
    })

    vi.mocked(mockConfig.getComposeCommand).mockResolvedValue(['docker', ['compose']])
    vi.mocked(mockConfig.getDBContainerInfo).mockResolvedValue({
      name: 'test-db',
      dumpCommand: 'mysqldump',
      cliCommand: 'mysql',
      adminCommand: 'mysqladmin',
      type: 'mysql' as const,
      credentials: { user: 'root', pass: 'password', db: 'testdb' },
      service: {},
    })

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Gzipping file using Node zlib...'))
    expect(mockStderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Note: Using Node.js compression may be slower than external gzip for large files'),
    )
    expect(pipeline).toHaveBeenCalledWith('read-stream', 'gzip-stream', 'write-stream')
    // The file path should be the resolved absolute path
    expect(createReadStream).toHaveBeenCalledWith(expect.stringMatching(/test\.sql$/))
    expect(createWriteStream).toHaveBeenCalledWith(expect.stringMatching(/test\.sql\.gz$/))
    expect(createGzip).toHaveBeenCalled()
    expect(unlink).toHaveBeenCalledWith(expect.stringMatching(/test\.sql$/))
    expect(which).toHaveBeenCalledWith('gzip')
  })

  it('should handle zlib compression errors for backup files', async () => {
    command.backup = true

    // Mock gzip not being available
    vi.mocked(which).mockResolvedValue(null)

    vi.mocked(mockConfig.get).mockImplementation((key: string) => {
      if (key === 'dbBackupPath') {
        return Promise.resolve('/backup')
      }

      return Promise.resolve('mock-value')
    })

    vi.mocked(mockConfig.getComposeCommand).mockResolvedValue(['docker', ['compose']])
    vi.mocked(mockConfig.getDBContainerInfo).mockResolvedValue({
      name: 'test-db',
      dumpCommand: 'mysqldump',
      cliCommand: 'mysql',
      adminCommand: 'mysqladmin',
      type: 'mysql' as const,
      credentials: { user: 'root', pass: 'password', db: 'testdb' },
      service: {},
    })

    // Mock pipeline failure
    vi.mocked(pipeline).mockRejectedValue(new Error('Compression failed'))

    const result = await command.command()

    expect(result).toBe(0) // Should still succeed for backups
    expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Gzipping file using Node zlib...'))
    expect(mockStderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Note: Using Node.js compression may be slower than external gzip for large files'),
    )
    expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('but failed to compress: Compression failed'))
  })

  it('should return error code for zlib compression errors on non-backup files', async () => {
    // Explicitly set backup to false
    command.backup = false

    // Mock gzip not being available
    vi.mocked(which).mockResolvedValue(null)

    vi.mocked(mockConfig.get).mockImplementation((key: string) => {
      if (key === 'dbSeed') {
        return Promise.resolve('test.sql.gz')
      }

      return Promise.resolve('mock-value')
    })

    vi.mocked(mockConfig.getComposeCommand).mockResolvedValue(['docker', ['compose']])
    vi.mocked(mockConfig.getDBContainerInfo).mockResolvedValue({
      name: 'test-db',
      dumpCommand: 'mysqldump',
      cliCommand: 'mysql',
      adminCommand: 'mysqladmin',
      type: 'mysql' as const,
      credentials: { user: 'root', pass: 'password', db: 'testdb' },
      service: {},
    })

    // Mock pipeline failure
    vi.mocked(pipeline).mockRejectedValue(new Error('Compression failed'))

    const result = await command.command()

    expect(result).toBe(2) // Should return error code for non-backup files
    expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Gzipping file using Node zlib...'))
    expect(mockStderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Note: Using Node.js compression may be slower than external gzip for large files'),
    )
    expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('but failed to compress: Compression failed'))
  })

  it('should not attempt gzipping when filename does not end with .gz', async () => {
    // Explicitly set backup to false
    command.backup = false

    vi.mocked(mockConfig.get).mockImplementation((key: string) => {
      if (key === 'dbSeed') {
        return Promise.resolve('test.sql')
      }

      return Promise.resolve('mock-value')
    })

    vi.mocked(mockConfig.getComposeCommand).mockResolvedValue(['docker', ['compose']])
    vi.mocked(mockConfig.getDBContainerInfo).mockResolvedValue({
      name: 'test-db',
      dumpCommand: 'mysqldump',
      cliCommand: 'mysql',
      adminCommand: 'mysqladmin',
      type: 'mysql' as const,
      credentials: { user: 'root', pass: 'password', db: 'testdb' },
      service: {},
    })

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockStderr.write).not.toHaveBeenCalledWith(expect.stringContaining('Gzipping'))
    expect(which).not.toHaveBeenCalled()
    expect(pipeline).not.toHaveBeenCalled()
  })
})

describe('DBResetCommand', () => {
  let command: DBResetCommand
  let mockCli: { run: ReturnType<typeof vi.fn> }
  let mockConfig: {
    get: ReturnType<typeof vi.fn>
    command: ReturnType<typeof vi.fn>
    getComposeCommand: ReturnType<typeof vi.fn>
    getComposeConfig: ReturnType<typeof vi.fn>
    getDBContainerInfo: ReturnType<typeof vi.fn>
    getCacheContainerInfo: ReturnType<typeof vi.fn>
    getDevPluginDelay: ReturnType<typeof vi.fn>
  }
  let mockStderr: { write: ReturnType<typeof vi.fn> }
  let mockStdout: { write: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()

    mockStderr = { write: vi.fn() }
    mockStdout = { write: vi.fn() }
    mockCli = { run: vi.fn().mockResolvedValue(0) }

    mockConfig = {
      get: vi
        .fn()
        .mockImplementation((key: string) => Promise.resolve(key === 'devPlugins' ? 'plugin-a, plugin-b' : undefined)),
      command: vi.fn().mockResolvedValue('docker'),
      getComposeCommand: vi.fn().mockImplementation(() => Promise.resolve(['docker', ['compose']])),
      getComposeConfig: vi.fn().mockResolvedValue({
        services: { db: {} },
        volumes: { db_data: { name: 'project_db_data' } },
      }),
      getDBContainerInfo: vi.fn().mockResolvedValue({
        service: { volumes: [{ type: 'volume', source: 'db_data' }] },
      }),
      getCacheContainerInfo: vi.fn().mockResolvedValue(undefined),
      getDevPluginDelay: vi.fn().mockResolvedValue(300),
    }

    command = new DBResetCommand()
    command.config = mockConfig as unknown as Config
    command.cli = mockCli as any
    command.context = { stderr: mockStderr, stdout: mockStdout } as any
    command.backup = false
    command.quiet = false

    vi.mocked(execC).mockResolvedValue({ exitCode: 0 } as any)
  })

  it('should wait for the DB to be ready before activating dev plugins', async () => {
    const result = await command.command()

    expect(result).toBe(0)
    expect(mockCli.run).toHaveBeenNthCalledWith(1, ['db', 'await', '--timeout=300'], command.context)
    expect(mockCli.run).toHaveBeenNthCalledWith(
      2,
      ['wp', 'plugin', 'activate', 'plugin-a', 'plugin-b'],
      command.context,
    )
    expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Done resetting DB!'))
  })

  it('should pass --quiet through to db await', async () => {
    command.quiet = true

    await command.command()

    expect(mockCli.run).toHaveBeenNthCalledWith(1, ['db', 'await', '--timeout=300', '--quiet'], command.context)
    expect(mockStdout.write).not.toHaveBeenCalled()
  })

  it('should not activate dev plugins if the DB never becomes available', async () => {
    mockCli.run.mockResolvedValueOnce(2)

    const result = await command.command()

    expect(result).toBe(2)
    expect(mockCli.run).toHaveBeenCalledTimes(1)
    expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Database did not become available'))
    expect(mockStdout.write).not.toHaveBeenCalledWith(expect.stringContaining('Done resetting DB!'))
  })

  it('should return an error if dev plugin activation fails', async () => {
    mockCli.run.mockResolvedValueOnce(0).mockResolvedValueOnce(1)

    const result = await command.command()

    expect(result).toBe(1)
    expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Failed to activate dev plugins!'))
    expect(mockStdout.write).not.toHaveBeenCalledWith(expect.stringContaining('Done resetting DB!'))
  })

  it('should skip waiting when there are no dev plugins', async () => {
    mockConfig.get.mockResolvedValue(undefined)

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockCli.run).not.toHaveBeenCalled()
    expect(mockConfig.getDevPluginDelay).not.toHaveBeenCalled()
  })

  it('should delete the DB volumes before bringing containers back up', async () => {
    await command.command()

    expect(execC).toHaveBeenCalledWith('docker', ['volume', 'rm', 'project_db_data'], expect.any(Object))
    expect(execC).toHaveBeenCalledWith('docker', ['compose', 'up', '--detach'], expect.any(Object))
  })
})
