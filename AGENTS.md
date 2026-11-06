# AGENTS.md

Jolt Scripts (`@joltdesign/scripts`) is a TypeScript CLI (`jolt`) that provides DevOps automation commands for
WordPress/Docker development and AWS/Nexcess deployment workflows. It is built on
[Clipanion](https://github.com/arcanis/clipanion) and validates configuration with [Zod](https://zod.dev).

## Communication style

- Skip affirmations and compliments. No "great question!" or "you're absolutely right!" - just respond directly
- Challenge flawed ideas openly when you spot issues
- Ask clarifying questions whenever a request is ambiguous or unclear

## Commands

- Install: `yarn install` (Yarn v4 via Corepack - **not** npm)
- Build: `yarn build` (`tsc -b`, then generates `jolt-config.schema.json`)
- Test: `yarn test:run` (Vitest, single run), `yarn test:coverage` for coverage
- **Never run `yarn test`** on its own - it starts Vitest in watch mode and blocks waiting for input
- Run a single test file: `yarn test:run tests/Command/DB.test.ts`
- Lint and format: `yarn lint --write` (Biome - **not** ESLint/Prettier). CI runs `yarn biome ci`
- Run the built CLI locally: `yarn node ./dist/cli.js <command>`
- Run a Node script: `yarn node <file>`

Before finishing any change, run `yarn lint --write`, `yarn build` and `yarn test:run`.

## Environment

- Yarn v4 with `nodeLinker: node-modules` (dependencies live in `node_modules`, not PnP). `enableScripts: false` is
  set, so dependency install scripts do not run
- Node version is managed by mise (`.mise.toml`, Node 26). CI tests against Node 22, 24, 26 and latest, so don't use
  APIs newer than Node 22
- TypeScript 7, ES modules (`"type": "module"`), `NodeNext` module resolution, `strict` mode
- Husky pre-commit hook formats staged files with Biome. The prepare-commit-msg hook prefixes commit messages with
  the Jira ticket from the branch name

## Project layout

- `src/cli.ts` - entry point; imports and registers every command
- `src/Command/` - one file per command group (`AWS`, `Build`, `Cache`, `Cmd`, `Config`, `DB`, `Docker`, `Nexcess`,
  `Prepare`, `SSH`, `Template`, `WP`), plus the `JoltCommand` base class
- `src/Config.ts` - config loading, templating, command overrides, Terraform and Docker Compose helpers
- `src/schemas.ts` - Zod schemas; `JoltConfigSchema` is the master schema
- `src/types/` - shared types (config, compose, package.json)
- `src/utils.ts` - `execC()`, `which()`, file helpers
- `src/errors.ts` - `ConfigValidationError`, `ContainerRuntimeError`
- `src/*.d.ts` - type declarations for untyped external libraries
- `scripts/generate-schema.js` - builds `jolt-config.schema.json` from the compiled Zod schema in `dist/`
- `tests/` - Vitest tests, mirroring the `src/` structure

## Architecture

### Commands

- All commands extend `JoltCommand` (abstract, in `src/Command/JoltCommand.ts`), which extends Clipanion's `Command`
- Implement `command(): Promise<number | undefined>`. `JoltCommand.execute()` handles config loading, site
  selection, required command checks and required config validation before calling it
- Declare CLI paths with `static paths = [['command', 'subcommand']]`
- Commands are **not** auto-registered - import and `cli.register()` each one in `src/cli.ts`
- `requiredCommands: string[]` declares external tools; they are resolved through `config.command()` and checked
  with `which()`. Missing tools return exit code 4
- `requiredConfig: string[]`, or override `getRequiredConfig()` for option-dependent keys. Missing config returns
  exit code 5
- `this.config` and `this.context` (stdio) are available in every command
- Every command gets `--site` / `-s` and `--for-each-site` / `-x` (`series` or `parallel`). Parallel runs use
  `AsyncLocalStorage`, so always read config through `this.config` rather than caching it elsewhere
- Shared base classes: `AWSCommand` (in `AWS.ts`, adds region handling) and `DockerCommand` (in `Docker.ts`)

### Configuration

- `getConfig()` loads the **first** existing, non-empty file from `.jolt.json`, `./bin/.env`, `.env`. Files are not
  merged
- Config values support templating with `{type:variable}`. Types: `arg`, `param`, `cmd`, `db`, `tf`/`tofu`/
  `terraform`, `conf`/`config`, `git`, `site` (e.g. `{tf:cluster_name}`, `{config:imageName}`, `{cmd:docker}`)
- `sites` holds per-site overrides; `config.setSite()` selects one, and `defaultSite` sets the default
- External commands can be overridden with environment variables (`DOCKER_COMMAND`, `COMPOSE_COMMAND`,
  `TERRAFORM_COMMAND`, `NODE_COMMAND`, `YARN_COMMAND`, `AWS_COMMAND`, `SSH_COMMAND`, `RSYNC_COMMAND`, `GIT_COMMAND`,
  `GZIP_COMMAND`), checked as `JOLT_<NAME>` first, then `<NAME>`, then the camelCase config key (e.g. `dockerCommand`)
- `JOLT_IGNORE_REQUIRED_COMMANDS` and `JOLT_IGNORE_REQUIRED_CONFIG` skip the pre-run checks
- `jolt config init` creates or updates `.jolt.json` with a `$schema` reference

### Schema

- All config schemas live in `src/schemas.ts`
- Add `.describe()` to every property - descriptions become the JSON Schema documentation
- Put defaults in `.default()`, not in descriptions. The generator drops properties with defaults from `required`
- `jolt-config.schema.json` is generated (and git-ignored) - never edit it by hand; run `yarn build`
- The schema is published to GitHub Pages by `.github/workflows/publish-schema.yml`

### External tools

- **Always use `execC()`** from `src/utils.ts` instead of calling `execa` directly. It filters out
  `null`/`undefined`/`false` args, wires up stdio from `{ context }`, and turns Docker/Podman daemon errors into a
  `ContainerRuntimeError` with a friendly message
- Docker Compose: `config.getComposeCommand()` returns a `[command, baseArgs]` tuple
- Terraform/OpenTofu: `tofu` is preferred if installed, otherwise `terraform`. Read outputs with `config.tfVar()`
  (cached; tries a `<site>_` prefixed key first)
- Docker images: `config.getDockerImageName(isDev)` and `config.getRemoteRepo(isDev)` handle dev variants
- Containers are discovered from Compose service images: MySQL/MariaDB for DB, Redis/Valkey for cache,
  `/\bwp[_-]?cli\b/i` for WP-CLI
- Dev and prod are distinguished throughout (ECS clusters, image tags, config keys)

## Conventions

### Output and errors

- In commands, write output through `this.context.stdout` / `stderr`, not `console.log`
- Use `ansis` for colour. Apply the colour to the whole message where possible, not just part of it
- Prefix messages with the emoji used by the area you're working in: ⚡ Jolt, 🐳 Docker, 🛢️ DB, ⛅ AWS, 📦 build,
  📋 WP updates, ✅ success, ⚠️ warnings
- Return exit codes from `command()`: `0` for success, a non-zero code for each distinct failure

### Code style

- British English everywhere (code, comments, output, docs)
- Leave an empty line before and after blocks (`if`, `for`, functions, etc.)
- Always use braces for `if` and loops - no single-line forms (Biome `useBlockStatements`)
- Comments go on their own line, not at the end of a line of code
- Use `.js` extensions in relative imports of TypeScript files
- Use top-level imports, not dynamic `await import()`
- Prefer `type` over `interface` unless you need declaration merging; use `export type` for type-only exports
- Prefer `const`; use `let` only when reassigning
- Destructure `this` (e.g. `const { stdout } = this.context`) instead of repeating `this.`
- Use ES classes rather than function-based objects
- Keep `package.json` scripts in alphabetical order, with subcommands after their parent (e.g. `test`, `test:run`)

### Tests

- Vitest with `globals: true`. Mock external dependencies (`execa`, file system, `which`)
- Mock whole modules with `vi.mock('../../src/utils.js')`, then use `vi.mocked()`
- Test abstract base classes through small concrete subclasses defined in the test
- Cover config validation failures as well as the success path

## Adding a command

1. Create or extend a file in `src/Command/` with a class extending `JoltCommand` (or `AWSCommand` /
   `DockerCommand`)
2. Set `static paths` and implement `command()`
3. Declare `requiredCommands` and `requiredConfig` (or `getRequiredConfig()`)
4. Run external tools with `execC(..., { context: this.context })`
5. Import and register the command in `src/cli.ts`
6. Add any new config keys to `src/schemas.ts` with `.describe()` and, where relevant, `.default()`
7. Add tests in `tests/Command/` and document the command in `README.md`
