import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { ConfigCommand } from '../../src/Command/Config.js'
import type { Config } from '../../src/Config.js'
import { which } from '../../src/utils.js'

vi.mock('../../src/utils.js', () => ({
  which: vi.fn(),
}))

describe('ConfigCommand', () => {
  let command: ConfigCommand
  let mockConfig: {
    asJson: ReturnType<typeof vi.fn>
    asEnvVars: ReturnType<typeof vi.fn>
    getCommandOverride: ReturnType<typeof vi.fn>
    parseArg: ReturnType<typeof vi.fn>
    configPath: string | undefined
    [Symbol.iterator]: ReturnType<typeof vi.fn>
  }
  let mockStdout: { write: Mock }
  let mockStderr: { write: Mock }
  let mockContext: { stdin: any; stdout: any; stderr: any }

  afterEach(() => {
    vi.restoreAllMocks()
  })

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

    // Create mock config
    mockConfig = {
      asJson: vi.fn(),
      asEnvVars: vi.fn(),
      getCommandOverride: vi.fn(),
      parseArg: vi.fn(),
      configPath: undefined,
      [Symbol.iterator]: vi.fn(),
    }

    // Create command instance
    command = new ConfigCommand()
    command.config = mockConfig as unknown as Config
    command.context = mockContext as any
    command.cli = { binaryLabel: 'jolt' } as any
    command.format = undefined

    // Mock which function to return path by default
    vi.mocked(which).mockResolvedValue('/usr/bin/command')
  })

  describe('command paths', () => {
    it('should register correct command path', () => {
      expect(ConfigCommand.paths).toEqual([['config']])
    })
  })

  describe('commands list', () => {
    it('should define the correct commands to check', () => {
      expect(command.commands).toEqual([
        'aws',
        'compose',
        'docker',
        'git',
        'gzip',
        'node',
        'rsync',
        'ssh',
        'tofu',
        'yarn',
      ])
    })
  })

  describe('pretty format (default)', () => {
    beforeEach(() => {
      mockConfig.getCommandOverride.mockImplementation((cmd: string) => {
        return Promise.resolve({
          command: cmd,
          source: undefined,
          sourceType: undefined,
        })
      })

      mockConfig[Symbol.iterator] = vi.fn().mockReturnValue(
        [
          ['testKey', 'testValue'],
          ['arrayKey', ['item1', 'item2']],
          ['objectKey', { unsupported: true }],
        ][Symbol.iterator](),
      )

      mockConfig.parseArg.mockImplementation((value: string) => Promise.resolve(value))
    })

    it('should display header and list commands and config in pretty format', async () => {
      const result = await command.command()

      expect(result).toBe(0)
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Config'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Commands:'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Config:'))
    })

    it('should show commands with their availability status', async () => {
      // Mock some commands as available and others as missing
      vi.mocked(which).mockImplementation((cmd: string) => {
        return Promise.resolve(cmd === 'docker' || cmd === 'git' ? `/usr/bin/${cmd}` : null)
      })

      mockConfig.getCommandOverride.mockImplementation((cmd: string) => {
        return Promise.resolve({
          command: cmd,
          source: undefined,
          sourceType: undefined,
        })
      })

      await command.command()

      // Should show available commands in green
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('docker'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('git'))

      // Should show missing commands with [Missing!] indicator
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('[Missing!]'))
    })

    it('should show command source information', async () => {
      mockConfig.getCommandOverride.mockImplementation((cmd: string) => {
        if (cmd === 'docker') {
          return Promise.resolve({
            command: 'podman',
            source: 'DOCKER_COMMAND',
            sourceType: 'env',
          })
        }
        if (cmd === 'compose') {
          return Promise.resolve({
            command: 'docker-compose',
            source: 'compose.command',
            sourceType: 'config',
          })
        }
        return Promise.resolve({
          command: cmd,
          source: undefined,
          sourceType: undefined,
        })
      })

      await command.command()

      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('[Env var: DOCKER_COMMAND]'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('[Config: compose.command]'))
    })

    it('should display config values with parsing information', async () => {
      mockConfig[Symbol.iterator] = vi.fn().mockReturnValue(
        [
          ['simpleKey', 'simpleValue'],
          ['parsedKey', '{config:template}'],
        ][Symbol.iterator](),
      )

      mockConfig.parseArg.mockImplementation((value: string) => {
        if (value === '{config:template}') {
          return Promise.resolve('parsed-value')
        }
        return Promise.resolve(value)
      })

      await command.command()

      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('simpleKey:'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('simpleValue'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('parsedKey:'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('parsed-value'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('[Parsed from: {config:template}]'))
    })

    it('should display array values with parsing information', async () => {
      mockConfig[Symbol.iterator] = vi.fn().mockReturnValue(
        [
          ['arrayKey', ['item1', { cmd: '{config:template}' }]],
          ['emptyArray', []],
        ][Symbol.iterator](),
      )

      mockConfig.parseArg.mockImplementation((value: string) => {
        if (value === '{config:template}') {
          return Promise.resolve('parsed-item')
        }
        return Promise.resolve(value)
      })

      await command.command()

      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('arrayKey:'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('item1'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('parsed-item'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('[Parsed from: {config:template}]'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('emptyArray:'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('[]'))
    })

    it('should handle unsupported config value types', async () => {
      mockConfig[Symbol.iterator] = vi
        .fn()
        .mockReturnValue([['objectKey', { nested: { value: 'test' } }]][Symbol.iterator]())

      await command.command()

      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('objectKey:'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Unsupported type:'))
    })

    it('should show config source file when available', async () => {
      mockConfig.configPath = '/path/to/.jolt.json'
      mockConfig[Symbol.iterator] = vi.fn().mockReturnValue([][Symbol.iterator]())

      await command.command()

      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('[Source file: /path/to/.jolt.json]'))
    })
  })

  describe('json format', () => {
    beforeEach(() => {
      command.format = 'json' as any
    })

    it('should output config as JSON', async () => {
      const mockJsonConfig = { key: 'value', nested: { prop: 'test' } }
      mockConfig.asJson.mockReturnValue(JSON.stringify(mockJsonConfig, null, 2))

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockConfig.asJson).toHaveBeenCalledOnce()
      expect(mockStdout.write).toHaveBeenCalledWith(`${JSON.stringify(mockJsonConfig, null, 2)}\n`)
      expect(mockStdout.write).not.toHaveBeenCalledWith(expect.stringContaining('Commands:'))
      expect(mockStdout.write).not.toHaveBeenCalledWith(expect.stringContaining('Config:'))
    })
  })

  describe('env format', () => {
    beforeEach(() => {
      command.format = 'env' as any
    })

    it('should output config as environment variables', async () => {
      const mockEnvVars = {
        JOLT_IMAGE_NAME: 'my-app',
        JOLT_PORT: '3000',
        JOLT_DEBUG: 'true',
      }
      mockConfig.asEnvVars.mockReturnValue(mockEnvVars)

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockConfig.asEnvVars).toHaveBeenCalledOnce()
      expect(mockStdout.write).toHaveBeenCalledWith('JOLT_IMAGE_NAME=my-app\nJOLT_PORT=3000\nJOLT_DEBUG=true\n')
      expect(mockStdout.write).not.toHaveBeenCalledWith(expect.stringContaining('Commands:'))
      expect(mockStdout.write).not.toHaveBeenCalledWith(expect.stringContaining('Config:'))
    })

    it('should handle empty env vars', async () => {
      mockConfig.asEnvVars.mockReturnValue({})

      const result = await command.command()

      expect(result).toBe(0)
      expect(mockStdout.write).toHaveBeenCalledWith('\n')
    })
  })

  describe('invalid format', () => {
    beforeEach(() => {
      command.format = 'invalid' as any
    })

    it('should return error code 1 and show error message for invalid format', async () => {
      const result = await command.command()

      expect(result).toBe(1)
      expect(mockStderr.write).toHaveBeenCalledWith(expect.stringContaining('Unknown format "invalid"'))
      // Verify that normal output paths are not taken
      expect(mockStdout.write).not.toHaveBeenCalledWith(expect.stringContaining('Commands:'))
      expect(mockStdout.write).not.toHaveBeenCalledWith(expect.stringContaining('Config:'))
    })
  })

  describe('listCommands method', () => {
    it('should list all commands with their status and source information', async () => {
      // Setup different command scenarios
      mockConfig.getCommandOverride.mockImplementation((cmd: string) => {
        switch (cmd) {
          case 'docker':
            return Promise.resolve({
              command: 'podman',
              source: 'DOCKER_COMMAND',
              sourceType: 'env',
            })
          case 'compose':
            return Promise.resolve({
              command: 'docker-compose',
              source: 'compose.command',
              sourceType: 'config',
            })
          case 'git':
            return Promise.resolve({
              command: 'git',
              source: undefined,
              sourceType: undefined,
            })
          default:
            return Promise.resolve({
              command: cmd,
              source: undefined,
              sourceType: undefined,
            })
        }
      })

      // Mock which to return different results for different commands
      vi.mocked(which).mockImplementation((cmd: string) => {
        return Promise.resolve(cmd === 'podman' || cmd === 'docker-compose' || cmd === 'git' ? `/usr/bin/${cmd}` : null)
      })

      await command.listCommands()

      // Verify header
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Commands:'))

      // Verify each command was processed
      for (const cmdName of command.commands) {
        expect(mockConfig.getCommandOverride).toHaveBeenCalledWith(cmdName)
        expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining(`${cmdName}:`))
      }

      // Verify source information is shown
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('[Env var: DOCKER_COMMAND]'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('[Config: compose.command]'))
    })
  })

  describe('listConfig method', () => {
    it('should list config values with proper formatting', async () => {
      mockConfig.configPath = '/test/.jolt.json'
      mockConfig[Symbol.iterator] = vi.fn().mockReturnValue(
        [
          ['stringKey', 'simple value'],
          ['templateKey', '{config:imageName}'],
          ['arrayKey', ['item1', { cmd: 'item2' }]],
          ['emptyArrayKey', []],
        ][Symbol.iterator](),
      )

      mockConfig.parseArg.mockImplementation((value: string) => {
        if (value === '{config:imageName}') {
          return Promise.resolve('my-app')
        }
        return Promise.resolve(value)
      })

      await command.listConfig()

      // Verify header with source file
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Config:'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('[Source file: /test/.jolt.json]'))

      // Verify each config entry was processed
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('stringKey:'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('simple value'))

      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('templateKey:'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('my-app'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('[Parsed from: {config:imageName}]'))

      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('arrayKey:'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('item1'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('item2'))

      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('emptyArrayKey:'))
      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('[]'))
    })

    it('should handle config without source file', async () => {
      mockConfig.configPath = undefined
      mockConfig[Symbol.iterator] = vi.fn().mockReturnValue([][Symbol.iterator]())

      await command.listConfig()

      expect(mockStdout.write).toHaveBeenCalledWith(expect.stringContaining('Config:'))
      expect(mockStdout.write).not.toHaveBeenCalledWith(expect.stringContaining('[Source file:'))
    })
  })
})
