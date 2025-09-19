import { stat } from 'node:fs/promises'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import realWhich from 'which'
import { ContainerRuntimeError } from '../src/errors.js'
import {
  clearWhichCache,
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

    describe('Container runtime error detection', () => {
      const mockStderr = {
        write: vi.fn(),
      }

      const context = {
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: mockStderr as any,
        env: {},
        colorDepth: 1,
      }

      beforeEach(() => {
        mockStderr.write.mockClear()
      })

      describe('Docker error detection', () => {
        it('should detect "Cannot connect to the Docker daemon" error', async () => {
          const mockExeca = vi.mocked(execa)
          const dockerError = new Error('Command failed') as any
          dockerError.stderr = 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.'

          mockExeca.mockRejectedValueOnce(dockerError)

          await expect(execC('docker', ['ps'], { context })).rejects.toThrow(ContainerRuntimeError)
          expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('🐳 Docker daemon is not running!'))
        })

        it('should detect "docker: error during connect" error', async () => {
          const mockExeca = vi.mocked(execa)
          const dockerError = new Error('Command failed') as any
          dockerError.stderr =
            'docker: error during connect: this error may indicate that the docker daemon is not running'

          mockExeca.mockRejectedValueOnce(dockerError)

          await expect(execC('docker', ['build', '.'], { context })).rejects.toThrow(ContainerRuntimeError)
          expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Docker daemon is not running!'))
        })

        it('should detect "Is the docker daemon running?" error', async () => {
          const mockExeca = vi.mocked(execa)
          const dockerError = new Error('Command failed') as any
          dockerError.stderr = 'Got permission denied while trying to connect. Is the docker daemon running?'

          mockExeca.mockRejectedValueOnce(dockerError)

          await expect(execC('docker', ['run', 'hello-world'], { context })).rejects.toThrow(ContainerRuntimeError)
          expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Docker daemon is not running!'))
        })

        it('should detect connection refused error', async () => {
          const mockExeca = vi.mocked(execa)
          const dockerError = new Error('Command failed') as any
          dockerError.stderr = 'dial unix /var/run/docker.sock: connect: connection refused'

          mockExeca.mockRejectedValueOnce(dockerError)

          await expect(execC('docker', ['version'], { context })).rejects.toThrow(ContainerRuntimeError)
          expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Docker daemon is not running!'))
        })

        it('should detect Docker Desktop not running error', async () => {
          const mockExeca = vi.mocked(execa)
          const dockerError = new Error('Command failed') as any
          dockerError.stderr = 'Docker Desktop is not running'

          mockExeca.mockRejectedValueOnce(dockerError)

          await expect(execC('docker', ['info'], { context })).rejects.toThrow(ContainerRuntimeError)
          expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Docker daemon is not running!'))
        })
      })

      describe('Podman error detection', () => {
        it('should detect "Cannot connect to Podman" error', async () => {
          const mockExeca = vi.mocked(execa)
          const podmanError = new Error('Command failed') as any
          podmanError.stderr = 'Cannot connect to Podman. Is the podman service running?'

          mockExeca.mockRejectedValueOnce(podmanError)

          await expect(execC('podman', ['ps'], { context })).rejects.toThrow(ContainerRuntimeError)
          expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('🐳 Podman daemon is not running!'))
        })

        it('should detect "Error: unable to connect to Podman" error', async () => {
          const mockExeca = vi.mocked(execa)
          const podmanError = new Error('Command failed') as any
          podmanError.stderr = 'Error: unable to connect to Podman socket'

          mockExeca.mockRejectedValueOnce(podmanError)

          await expect(execC('podman', ['run', 'alpine'], { context })).rejects.toThrow(ContainerRuntimeError)
          expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Podman daemon is not running!'))
        })

        it('should detect Podman Desktop not running error', async () => {
          const mockExeca = vi.mocked(execa)
          const podmanError = new Error('Command failed') as any
          podmanError.stderr = 'Podman Desktop is not running'

          mockExeca.mockRejectedValueOnce(podmanError)

          await expect(execC('podman', ['info'], { context })).rejects.toThrow(ContainerRuntimeError)
          expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Podman daemon is not running!'))
        })

        it('should detect Podman socket connection refused error', async () => {
          const mockExeca = vi.mocked(execa)
          const podmanError = new Error('Command failed') as any
          podmanError.stderr = 'dial unix /run/user/1000/podman/podman.sock: connect: connection refused'

          mockExeca.mockRejectedValueOnce(podmanError)

          await expect(execC('podman', ['version'], { context })).rejects.toThrow(ContainerRuntimeError)
          expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Podman daemon is not running!'))
        })
      })

      describe('Rancher Desktop error detection', () => {
        it('should detect Rancher Desktop not running error', async () => {
          const mockExeca = vi.mocked(execa)
          const rancherError = new Error('Command failed') as any
          rancherError.stderr = 'Rancher Desktop is not running'

          mockExeca.mockRejectedValueOnce(rancherError)

          await expect(execC('docker', ['ps'], { context })).rejects.toThrow(ContainerRuntimeError)
          expect(mockStderr.write).toHaveBeenCalledWith(
            expect.stringContaining('🐳 Rancher Desktop daemon is not running!'),
          )
        })

        it('should detect Rancher Docker socket connection refused error', async () => {
          const mockExeca = vi.mocked(execa)
          const rancherError = new Error('Command failed') as any
          rancherError.stderr = 'dial unix /Users/user/.rd/docker.sock: connect: connection refused'

          mockExeca.mockRejectedValueOnce(rancherError)

          await expect(execC('docker', ['run', 'nginx'], { context })).rejects.toThrow(ContainerRuntimeError)
          expect(mockStderr.write).toHaveBeenCalledWith(
            expect.stringContaining('Rancher Desktop daemon is not running!'),
          )
        })

        it('should detect connection refused with rancher in path', async () => {
          const mockExeca = vi.mocked(execa)
          const rancherError = new Error('Command failed') as any
          rancherError.stderr = 'connection refused connecting to rancher docker daemon'

          mockExeca.mockRejectedValueOnce(rancherError)

          await expect(execC('docker', ['build', '.'], { context })).rejects.toThrow(ContainerRuntimeError)
          expect(mockStderr.write).toHaveBeenCalledWith(
            expect.stringContaining('Rancher Desktop daemon is not running!'),
          )
        })
      })

      describe('General error handling', () => {
        it('should not trigger container runtime error detection for non-container commands', async () => {
          const mockExeca = vi.mocked(execa)
          const error = new Error('Command failed') as any
          error.stderr = 'Cannot connect to the Docker daemon'

          mockExeca.mockRejectedValueOnce(error)

          await expect(execC('npm', ['install'], { context })).rejects.toThrow('Command failed')
          expect(mockStderr.write).not.toHaveBeenCalled()
        })

        it('should not trigger container runtime error detection for unrelated docker errors', async () => {
          const mockExeca = vi.mocked(execa)
          const dockerError = new Error('Command failed') as any
          dockerError.stderr = 'docker: invalid flag --invalid-flag'

          mockExeca.mockRejectedValueOnce(dockerError)

          await expect(execC('docker', ['--invalid-flag'], { context })).rejects.toThrow('Command failed')
          expect(mockStderr.write).not.toHaveBeenCalled()
        })

        it('should handle container runtime errors without stderr', async () => {
          const mockExeca = vi.mocked(execa)
          const dockerError = new Error('Cannot connect to the Docker daemon') as any
          dockerError.stderr = ''

          mockExeca.mockRejectedValueOnce(dockerError)

          await expect(execC('docker', ['ps'], { context })).rejects.toThrow(ContainerRuntimeError)
          expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Docker daemon is not running!'))
        })

        it('should work without context stderr', async () => {
          const mockExeca = vi.mocked(execa)
          const dockerError = new Error('Command failed') as any
          dockerError.stderr = 'Cannot connect to the Docker daemon'

          mockExeca.mockRejectedValueOnce(dockerError)

          await expect(execC('docker', ['ps'])).rejects.toThrow(ContainerRuntimeError)
          // Should not crash when context.stderr is not available
        })
      })
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
    beforeEach(() => {
      vi.mocked(execa).mockClear()
      vi.mocked(realWhich).mockClear()
      clearWhichCache()
    })

    it('should handle docker compose commands when plugin is available', async () => {
      vi.mocked(realWhich).mockResolvedValueOnce('/usr/bin/docker')
      vi.mocked(execa).mockResolvedValueOnce({ stdout: 'Docker Compose version v2.39.2' } as any)

      const result = await which('docker compose')
      expect(result).toBe('/usr/bin/docker')
      expect(execa).toHaveBeenCalledWith('docker', ['compose', 'version'], {
        stdio: 'ignore',
        timeout: 5000,
      })
    })

    it('should return null when docker compose plugin is not available', async () => {
      vi.mocked(realWhich).mockResolvedValueOnce('/usr/bin/docker')
      vi.mocked(execa).mockRejectedValueOnce(new Error("docker: 'compose' is not a docker command"))

      const result = await which('docker compose')
      expect(result).toBeNull()
    })

    it('should return null when docker itself is not available', async () => {
      vi.mocked(realWhich).mockResolvedValueOnce(null as unknown as string)

      const result = await which('docker compose')
      expect(result).toBeNull()
      // Should not try to run docker compose version if docker is not available
      expect(execa).not.toHaveBeenCalled()
    })

    it('should handle regular commands normally', async () => {
      vi.mocked(realWhich).mockResolvedValueOnce('/usr/bin/ls')

      const result = await which('ls')
      expect(result).toBe('/usr/bin/ls')
      expect(realWhich).toHaveBeenCalledWith('ls', { nothrow: true })
    })

    it('should return null for non-existent commands', async () => {
      vi.mocked(realWhich).mockResolvedValueOnce(null as unknown as string)

      const result = await which('nonexistent')
      expect(result).toBeNull()
    })

    it('should cache results and not call external commands repeatedly', async () => {
      vi.mocked(realWhich).mockResolvedValueOnce('/usr/bin/ls')

      // First call should invoke realWhich
      const result1 = await which('ls')
      expect(result1).toBe('/usr/bin/ls')
      expect(realWhich).toHaveBeenCalledTimes(1)

      // Second call should use cache and not invoke realWhich again
      const result2 = await which('ls')
      expect(result2).toBe('/usr/bin/ls')
      expect(realWhich).toHaveBeenCalledTimes(1)
    })

    it('should cache docker compose results and not re-execute docker commands', async () => {
      vi.mocked(realWhich).mockResolvedValueOnce('/usr/bin/docker')
      vi.mocked(execa).mockResolvedValueOnce({ stdout: 'Docker Compose version v2.39.2' } as any)

      // First call should invoke both realWhich and execa
      const result1 = await which('docker compose')
      expect(result1).toBe('/usr/bin/docker')
      expect(realWhich).toHaveBeenCalledTimes(1)
      expect(execa).toHaveBeenCalledTimes(1)

      // Second call should use cache and not invoke external commands again
      const result2 = await which('docker compose')
      expect(result2).toBe('/usr/bin/docker')
      expect(realWhich).toHaveBeenCalledTimes(1)
      expect(execa).toHaveBeenCalledTimes(1)
    })

    it('should cache null results for non-existent commands', async () => {
      vi.mocked(realWhich).mockResolvedValueOnce(null as unknown as string)

      // First call should invoke realWhich
      const result1 = await which('nonexistent')
      expect(result1).toBeNull()
      expect(realWhich).toHaveBeenCalledTimes(1)

      // Second call should use cache and not invoke realWhich again
      const result2 = await which('nonexistent')
      expect(result2).toBeNull()
      expect(realWhich).toHaveBeenCalledTimes(1)
    })
  })
})
