import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DBDumpCommand } from '../../src/Command/DB.js'
import type { Config } from '../../src/Config.js'

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

vi.mock('node:fs', () => ({
  createReadStream: vi.fn(),
  createWriteStream: vi.fn(),
}))

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
    command.config = mockConfig as Config
    command.context = {
      stderr: mockStderr,
      stdout: mockStdout,
    } as any

    // Reset backup flag to default
    command.backup = false

    // Mock execa to return successful result
    const { execa } = await import('execa')
    vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any)

    // Setup Node.js module mocks
    const { pipeline } = await import('node:stream/promises')
    const { createGzip } = await import('node:zlib')
    const { createReadStream, createWriteStream } = await import('node:fs')
    const { unlink } = await import('node:fs/promises')

    vi.mocked(pipeline).mockResolvedValue(undefined)
    vi.mocked(createGzip).mockReturnValue('gzip-stream' as any)
    vi.mocked(createReadStream).mockReturnValue('read-stream' as any)
    vi.mocked(createWriteStream).mockReturnValue('write-stream' as any)
    vi.mocked(unlink).mockResolvedValue(undefined)
  })

  it('should use external gzip when available', async () => {
    const { which } = await import('../../src/utils.js')

    // Explicitly set backup to false
    command.backup = false

    // Mock gzip being available
    vi.mocked(which).mockResolvedValue('/usr/bin/gzip')

    vi.mocked(mockConfig.get).mockImplementation((key: string) => {
      if (key === 'dbSeed') return Promise.resolve('test.sql.gz')
      return Promise.resolve('mock-value')
    })

    vi.mocked(mockConfig.getComposeCommand).mockResolvedValue(['docker', ['compose']])
    vi.mocked(mockConfig.getDBContainerInfo).mockResolvedValue({
      name: 'test-db',
      dumpCommand: 'mysqldump',
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
    const { which } = await import('../../src/utils.js')
    const { pipeline } = await import('node:stream/promises')
    const { createGzip } = await import('node:zlib')
    const { createReadStream, createWriteStream } = await import('node:fs')
    const { unlink } = await import('node:fs/promises')

    // Explicitly set backup to false
    command.backup = false

    // Mock gzip not being available
    vi.mocked(which).mockResolvedValue(null)

    vi.mocked(mockConfig.get).mockImplementation((key: string) => {
      if (key === 'dbSeed') return Promise.resolve('test.sql.gz')
      return Promise.resolve('mock-value')
    })

    vi.mocked(mockConfig.getComposeCommand).mockResolvedValue(['docker', ['compose']])
    vi.mocked(mockConfig.getDBContainerInfo).mockResolvedValue({
      name: 'test-db',
      dumpCommand: 'mysqldump',
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
    const { which } = await import('../../src/utils.js')
    const { pipeline } = await import('node:stream/promises')

    command.backup = true

    // Mock gzip not being available
    vi.mocked(which).mockResolvedValue(null)

    vi.mocked(mockConfig.get).mockImplementation((key: string) => {
      if (key === 'dbBackupPath') return Promise.resolve('/backup')
      return Promise.resolve('mock-value')
    })

    vi.mocked(mockConfig.getComposeCommand).mockResolvedValue(['docker', ['compose']])
    vi.mocked(mockConfig.getDBContainerInfo).mockResolvedValue({
      name: 'test-db',
      dumpCommand: 'mysqldump',
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
    const { which } = await import('../../src/utils.js')
    const { pipeline } = await import('node:stream/promises')

    // Explicitly set backup to false
    command.backup = false

    // Mock gzip not being available
    vi.mocked(which).mockResolvedValue(null)

    vi.mocked(mockConfig.get).mockImplementation((key: string) => {
      if (key === 'dbSeed') return Promise.resolve('test.sql.gz')
      return Promise.resolve('mock-value')
    })

    vi.mocked(mockConfig.getComposeCommand).mockResolvedValue(['docker', ['compose']])
    vi.mocked(mockConfig.getDBContainerInfo).mockResolvedValue({
      name: 'test-db',
      dumpCommand: 'mysqldump',
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
    const { which } = await import('../../src/utils.js')
    const { pipeline } = await import('node:stream/promises')

    // Explicitly set backup to false
    command.backup = false

    vi.mocked(mockConfig.get).mockImplementation((key: string) => {
      if (key === 'dbSeed') return Promise.resolve('test.sql')
      return Promise.resolve('mock-value')
    })

    vi.mocked(mockConfig.getComposeCommand).mockResolvedValue(['docker', ['compose']])
    vi.mocked(mockConfig.getDBContainerInfo).mockResolvedValue({
      name: 'test-db',
      dumpCommand: 'mysqldump',
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
