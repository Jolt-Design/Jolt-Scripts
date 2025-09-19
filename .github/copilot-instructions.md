# Jolt Scripts - AI Assistant Instructions

This is a TypeScript CLI tool that provides DevOps automation commands for WordPress/Docker development and AWS deployment workflows.

## Core Architecture

### Command Pattern Implementation
- All commands extend `JoltCommand` (abstract base class) which extends Clipanion's `Command`
- Commands live in `src/Command/` and follow the pattern: export class implementing `command(): Promise<number | undefined>`
- Commands register paths with static `paths = [['command', 'subcommand']]` and get auto-registered in `src/cli.ts`
- Use `requiredCommands: string[]` property to declare external tool dependencies (checked via `which()`)

### Configuration System
- Multi-source config loading: `.jolt.json` (JSON) → `./bin/.env` → `.env` (environment files)
- Config class provides templating with `{type:variable}` syntax: `{tf:cluster_name}`, `{config:imageName}`, `{cmd:docker}`
- Site-specific overrides: `config.setSite()` allows per-environment configs within same file
- Command overrides via environment variables: `JOLT_DOCKER_COMMAND`, `TERRAFORM_COMMAND`, etc.

### External Tool Integration
- Docker Compose operations: Use `config.getComposeCommand()` to get `[command, baseArgs]` tuple
- Terraform/OpenTofu: Auto-detects `tofu` vs `terraform`, outputs cached via `config.tfVar()`
- AWS CLI: All AWS commands extend `AWSCommand` base class with region handling
- WordPress: WP-CLI container detection via compose service image patterns (`/\bwp[_-]?cli\b/i`)

## Project Conventions

### Error Handling & Process Management
- Use `execC()` wrapper for all external commands (handles null arg filtering, context passing)
- Commands return exit codes (0 = success, >0 = error codes with specific meanings)
- Use `ansis` for colored terminal output with consistent emoji prefixes: ⚡🐳🛢️⛅🗃️📋
- All long-running operations should use `context` for stdio streams

### Testing Patterns
- Vitest with extensive mocking of external dependencies (`execa`, file system, `which`)
- Mock entire modules: `vi.mock('../../src/utils.js')` then use `vi.mocked()`
- Abstract command testing via concrete test implementations extending base classes
- Config validation testing with Zod schema validation error scenarios

### Development Workflow
- Build: `yarn build` (TypeScript compilation to `dist/`)
- Test: `yarn test:run` (Vitest), `yarn test:coverage` for coverage reports
- **Do NOT EVER** use `yarn test` without the :run suffix to run tests as that blocks waiting for user input
- Lint/Format: `yarn lint` calls Biome (NOT ESLint/Prettier)
- Package manager: **Yarn v4 with PnP** (note `.yarn/` in workspace) - NOT npm
- **Ensure all changes pass Biome linting** with `yarn lint` before completion
- Prefer using `yarn lint --write` or `yarn lint --write --unsafe` to fix lint issues rather than doing it yourself

### TypeScript Conventions
- ES modules (`"type": "module"`) with `.js` imports for TS files
- Strict TypeScript config with `NodeNext` module resolution
- Type definitions in `src/*.d.ts` for external libs and internal config types
- Use `export type` for type-only exports

### Coding style
- Prefer using empty newlines before and after code blocks (if, for, etc.)
- Put comments on their own line instead of after the code
- Prefer ES6 classes to class-like objects
- Keep package.json scripts in alphabetical order, with subcommands after their parents

## Key Integration Points

### Docker/Compose Operations
- Image name resolution: `config.getDockerImageName(isDev)` handles dev suffixes
- Container discovery: Services found by image regex patterns (mysql/mariadb for DB, redis/valkey for cache)
- Multi-stage workflows: build → tag → push → deploy sequences

### Environment-Aware Deployments
- Dev vs Prod distinction throughout (ECS clusters, image tags, config keys)
- Terraform state integration for dynamic config values
- Site-specific overrides for multi-tenant deployments

### Database Operations
- Auto-detection of MySQL/MariaDB containers from compose config
- Credential extraction from environment variables or explicit config
- Dump/restore operations with gzip compression support

When implementing new commands:
1. Extend `JoltCommand`, implement `command()` method
2. Add to command registration in `src/cli.ts`
3. Use config templating for dynamic values
4. Follow emoji + ansis color conventions for output
5. Test with mocked dependencies and various config scenarios
