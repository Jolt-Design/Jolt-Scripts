import { readFile, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { TemplateCommand } from '../../src/Command/Template.js'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

describe('TemplateCommand', () => {
  let command: TemplateCommand
  let mockConfig: { parseArg: Mock }
  let mockStdout: { write: Mock }
  let mockStderr: { write: Mock }

  beforeEach(() => {
    vi.clearAllMocks()

    mockStdout = { write: vi.fn() }
    mockStderr = { write: vi.fn() }

    mockConfig = {
      parseArg: vi.fn(),
    }

    command = new TemplateCommand()
    command.context = {
      stdin: process.stdin,
      stdout: mockStdout,
      stderr: mockStderr,
    } as any
    command.config = mockConfig as any
    command.getHeader = vi.fn(() => 'Test Header\n')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('processes template file successfully', async () => {
    const mockReadFile = readFile as Mock
    const mockWriteFile = writeFile as Mock

    command.input = 'input.txt'
    command.output = 'output.txt'
    mockReadFile.mockResolvedValueOnce(Buffer.from('Hello {cmd:docker}'))
    mockConfig.parseArg.mockResolvedValueOnce('Hello docker')

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockReadFile).toHaveBeenCalledWith('input.txt')
    expect(mockConfig.parseArg).toHaveBeenCalledWith('Hello {cmd:docker}')
    expect(mockWriteFile).toHaveBeenCalledWith('output.txt', 'Hello docker', 'utf-8')
  })

  it('handles file read errors', async () => {
    const mockReadFile = readFile as Mock

    command.input = 'missing.txt'
    command.output = 'output.txt'
    mockReadFile.mockRejectedValueOnce(new Error('File not found'))

    const result = await command.command()

    expect(result).toBe(1)
  })

  it('handles template parsing errors', async () => {
    const mockReadFile = readFile as Mock

    command.input = 'input.txt'
    command.output = 'output.txt'
    mockReadFile.mockResolvedValueOnce(Buffer.from('Hello'))
    mockConfig.parseArg.mockRejectedValueOnce(new Error('Parse error'))

    const result = await command.command()

    expect(result).toBe(2)
  })

  it('handles file write errors', async () => {
    const mockReadFile = readFile as Mock
    const mockWriteFile = writeFile as Mock

    command.input = 'input.txt'
    command.output = 'output.txt'
    mockReadFile.mockResolvedValueOnce(Buffer.from('Hello'))
    mockConfig.parseArg.mockResolvedValueOnce('Hello')
    mockWriteFile.mockRejectedValueOnce(new Error('Permission denied'))

    const result = await command.command()

    expect(result).toBe(3)
  })

  it('suppresses output when quiet is true', async () => {
    const mockReadFile = readFile as Mock
    const mockWriteFile = writeFile as Mock

    command.input = 'input.txt'
    command.output = 'output.txt'
    command.quiet = true
    mockReadFile.mockResolvedValueOnce(Buffer.from('Hello'))
    mockConfig.parseArg.mockResolvedValueOnce('Hello')

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockStdout.write).not.toHaveBeenCalled()
    expect(mockWriteFile).toHaveBeenCalledWith('output.txt', 'Hello', 'utf-8')
  })

  it('outputs normally when quiet is false', async () => {
    const mockReadFile = readFile as Mock

    command.input = 'input.txt'
    command.output = 'output.txt'
    command.quiet = false
    mockReadFile.mockResolvedValueOnce(Buffer.from('Hello'))
    mockConfig.parseArg.mockResolvedValueOnce('Hello')

    const result = await command.command()

    expect(result).toBe(0)
    expect(mockStdout.write).toHaveBeenCalledWith('Test Header\n')
    expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Template processed successfully'))
  })

  it('shows errors even in quiet mode', async () => {
    const mockReadFile = readFile as Mock

    command.input = 'missing.txt'
    command.output = 'output.txt'
    command.quiet = true
    mockReadFile.mockRejectedValueOnce(new Error('File not found'))

    const result = await command.command()

    expect(result).toBe(1)
    expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Error reading input file'))
  })
})
