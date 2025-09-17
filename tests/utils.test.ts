import { stat } from 'node:fs/promises'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import realWhich from 'which'
import {
  constToCamel,
  delay,
  directoryExists,
  execC,
  fileExists,
  keyToConst,
  replaceAsync,
  which,
} from '../src/utils.js'

vi.mock('node:fs/promises')
vi.mock('execa')
vi.mock('which')

describe('utils', () => {
  describe('fileExists', () => {
    it('should return true for existing files', async () => {
      vi.mocked(stat).mockResolvedValueOnce({
        isFile: () => true,
      } as any)

      expect(await fileExists('/path/to/file')).toBe(true)
    })

    it('should return false for directories', async () => {
      vi.mocked(stat).mockResolvedValueOnce({
        isFile: () => false,
      } as any)

      expect(await fileExists('/path/to/dir')).toBe(false)
    })

    it('should return false when stat throws', async () => {
      vi.mocked(stat).mockRejectedValueOnce(new Error('ENOENT'))

      expect(await fileExists('/nonexistent')).toBe(false)
    })
  })

  describe('directoryExists', () => {
    it('should return true for existing directories', async () => {
      vi.mocked(stat).mockResolvedValueOnce({
        isDirectory: () => true,
      } as any)

      expect(await directoryExists('/path/to/dir')).toBe(true)
    })

    it('should return false for files', async () => {
      vi.mocked(stat).mockResolvedValueOnce({
        isDirectory: () => false,
      } as any)

      expect(await directoryExists('/path/to/file')).toBe(false)
    })

    it('should return false when stat throws', async () => {
      vi.mocked(stat).mockRejectedValueOnce(new Error('ENOENT'))

      expect(await directoryExists('/nonexistent')).toBe(false)
    })
  })

  describe('constToCamel', () => {
    it('should convert constant case to camel case', () => {
      expect(constToCamel('HELLO_WORLD')).toBe('helloWorld')
      expect(constToCamel('MY_VARIABLE_NAME')).toBe('myVariableName')
      expect(constToCamel('SINGLE')).toBe('single')
    })
  })

  describe('keyToConst', () => {
    it('should convert camel case to constant case', () => {
      expect(keyToConst('helloWorld')).toBe('HELLO_WORLD')
      expect(keyToConst('myVariableName')).toBe('MY_VARIABLE_NAME')
      expect(keyToConst('single')).toBe('SINGLE')
    })
  })

  describe('execC', () => {
    it('should execute commands with clean args by default', async () => {
      const mockExeca = vi.mocked(execa)
      mockExeca.mockResolvedValueOnce({ stdout: 'success' } as any)

      await execC('test', ['arg1', null, 'arg2', undefined, 'arg3', false])

      expect(mockExeca).toHaveBeenCalledWith('test', ['arg1', 'arg2', 'arg3'], expect.any(Object))
    })

    it('should preserve all args when cleanArgs is false', async () => {
      const mockExeca = vi.mocked(execa)
      mockExeca.mockResolvedValueOnce({ stdout: 'success' } as any)

      await execC('test', ['arg1', null, 'arg2'], { cleanArgs: false })

      expect(mockExeca).toHaveBeenCalledWith('test', ['arg1', null, 'arg2'], expect.any(Object))
    })

    it('should use context streams when provided', async () => {
      const mockExeca = vi.mocked(execa)
      mockExeca.mockResolvedValueOnce({ stdout: 'success' } as any)

      const context = {
        stdin: 'stdin' as any,
        stdout: 'stdout' as any,
        stderr: 'stderr' as any,
        env: {},
        colorDepth: 1,
      }

      await execC('test', ['arg'], { context })

      expect(mockExeca).toHaveBeenCalledWith(
        'test',
        ['arg'],
        expect.objectContaining({
          stdin: 'stdin',
          stdout: 'stdout',
          stderr: 'stderr',
        }),
      )
    })
  })

  describe('delay', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should resolve after specified delay', async () => {
      const promise = delay(1000)

      vi.advanceTimersByTime(999)
      expect(await Promise.race([promise, 'not done'])).toBe('not done')

      vi.advanceTimersByTime(1)
      expect(await promise).toBeNull()
    })
  })

  describe('replaceAsync', () => {
    it('should replace matches with async function results', async () => {
      const input = 'hello {name} and {name}'
      const asyncFn = async (match: string) => {
        await delay(1)
        return match === '{name}' ? 'world' : match
      }

      const result = await replaceAsync(input, /{name}/g, asyncFn)
      expect(result).toBe('hello world and world')
    })
  })

  describe('which', () => {
    it('should handle docker compose commands', async () => {
      vi.mocked(realWhich).mockResolvedValueOnce('/usr/bin/docker')

      const result = await which('docker compose')
      expect(result).toBe('/usr/bin/docker')
    })

    it('should return null for non-existent commands', async () => {
      vi.mocked(realWhich).mockResolvedValueOnce(null as unknown as string)

      const result = await which('nonexistent')
      expect(result).toBeNull()
    })
  })
})
