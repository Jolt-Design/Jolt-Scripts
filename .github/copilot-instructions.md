# Jolt Scripts - AI Assistant Instructions

This is a TypeScript CLI tool that provides DevOps automation commands for WordPress/Docker development and AWS deployment workflows.

## Core Architecture

### Command Pattern Implementation
- All commands extend `JoltCommand` (abstract base class) which extends Clipanion's `Command`
- Commands live in `src/Command/` and follow the pattern: export class implementing `command(): Promise<number | undefined>`
- Commands register paths with static `paths = [['command', 'subcommand']]` and get auto-registered in `src/cli.ts`
- Use `requiredCommands: string[]` property to declare external tool dependencies (checked via `which()`)
- Use `requiredConfig: string[]` or override `getRequiredConfig()` to validate config before execution
- Commands get `this.config` and `this.context` automatically injected for stdio and configuration access

### Configuration System & Schema
- Multi-source config loading: `.jolt.json` (JSON) → `./bin/.env` → `.env` (environment files)
- **Zod-based validation**: All config schemas defined in `src/schemas.ts` with `JoltConfigSchema` as the master schema
- **Automated JSON Schema**: `yarn build` generates `jolt-config.schema.json` from Zod using native `toJSONSchema()`
- Config templating with `{type:variable}` syntax: `{tf:cluster_name}`, `{config:imageName}`, `{cmd:docker}`
- Site-specific overrides: `config.setSite()` allows per-environment configs within same file
- Command overrides via environment variables: `JOLT_DOCKER_COMMAND`, `TERRAFORM_COMMAND`, etc.
- `jolt config init` command creates/updates `.jolt.json` with proper schema reference (Yarn PnP compatible)

### External Tool Integration
- **execC() wrapper**: Use for ALL external commands - handles null arg filtering, context stdio, container runtime errors
- Docker Compose operations: Use `config.getComposeCommand()` to get `[command, baseArgs]` tuple
- Terraform/OpenTofu: Auto-detects `tofu` vs `terraform`, outputs cached via `config.tfVar()`
- AWS CLI: All AWS commands extend `AWSCommand` base class with region handling
- WordPress: WP-CLI container detection via compose service image patterns (`/\bwp[_-]?cli\b/i`)

## Project Conventions

### Error Handling & Process Management
- **Always use `execC()`** instead of raw `execa` - provides context passing, null filtering, container daemon error detection
- Commands return exit codes (0 = success, >0 = error codes with specific meanings)
- Use `ansis` for colored terminal output with consistent emoji prefixes: ⚡🐳🛢️⛅🗃️📋
- All operations use `context` for stdio streams: `{ context }` option in execC, `context.stdout.write()`
- Container runtime errors get friendly messages via `ContainerRuntimeError` class

### Schema & Configuration Management
- **Add descriptions to Zod schemas**: Use `.describe()` for all properties to generate rich JSON Schema docs
- **Use proper defaults**: `.default()` on Zod schemas, not in descriptions - auto-removes from required properties
- Schema generation script (`scripts/generate-schema.js`) fixes Zod quirks and adds $schema property support
- Test schema changes by regenerating with `yarn build` (includes schema generation)

### Testing Patterns
- Vitest with extensive mocking of external dependencies (`execa`, file system, `which`)
- Mock entire modules: `vi.mock('../../src/utils.js')` then use `vi.mocked()`
- Abstract command testing via concrete test implementations extending base classes
- Config validation testing with Zod schema validation error scenarios

### Development Workflow
- Build: `yarn build` (TypeScript compilation + schema generation)
- Test: `yarn test:run` (Vitest), `yarn test:coverage` for coverage reports
- **CRITICAL: NEVER use `yarn test`** without `:run` suffix - blocks waiting for user input
- Lint/Format: `yarn lint --write` calls Biome (NOT ESLint/Prettier)
- Package manager: **Yarn v4 with PnP** (note `.yarn/` in workspace) - NOT npm
- **Always run `yarn lint --write`** before completing changes - fixes most issues automatically
- When running a node file, use `yarn node <file>` to ensure PnP context

### TypeScript Conventions
- ES modules (`"type": "module"`) with `.js` imports for TS files in Node.js context
- Strict TypeScript config with `NodeNext` module resolution
- Type definitions in `src/*.d.ts` for external libs and internal config types
- Use `export type` for type-only exports, regular exports for runtime values

### Coding Style
- **Empty newlines before/after code blocks** (if, for, functions, etc.) - enforced project convention
- Comments on separate lines, not inline
- ES6 classes over function-based objects
- Package.json scripts in alphabetical order, subcommands after parents
- Prefer destructing `this` rather than repeated `this.` references
- Use `const` over `let` unless reassignment is needed
- Prefer using top level imports rather than dynamic `await import()`
- Where possible, apply ansis colours to the entire message, not just parts of it
- Prefer using TypeScript types over interfaces unless necessary for declaration merging

## Key Integration Points

### Docker/Compose Operations
- Image name resolution: `config.getDockerImageName(isDev)` handles dev suffixes automatically
- Container discovery: Services found by image regex patterns (mysql/mariadb for DB, redis/valkey for cache)
- Multi-stage workflows: build → tag → push → deploy sequences with proper context passing

### Environment-Aware Deployments
- Dev vs Prod distinction throughout (ECS clusters, image tags, config keys)
- Terraform state integration for dynamic config values via `config.tfVar()`
- Site-specific overrides for multi-tenant deployments using `sites` config object

When implementing new commands:
1. Extend `JoltCommand`, implement `command(): Promise<number | undefined>`
2. Add to command registration in `src/cli.ts` imports and CLI registration
3. Use `execC()` for external commands with `{ context }` option
4. Define required config in `requiredConfig` array or `getRequiredConfig()` method
5. Use config templating for dynamic values and proper emoji + ansis color conventions
6. Test with mocked dependencies and various config scenarios using Vitest patterns
