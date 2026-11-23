# Using Jolt Scripts (for agents)

`jolt` describes itself. Use the CLI to find out what a command does, which config it needs and what it will change, rather than reading `dist/` or the source.

Run it the way the repo does (check `package.json` scripts and the repo's AGENTS.md). It is usually `yarn jolt <command>`.

## Finding out how to do something

1. `jolt --help` lists every command by category.
2. `jolt <command> --help` shows one command's options, required config and tools, exit codes and examples. Include the full path for subcommands, e.g. `jolt wp update merge --help`.
3. `jolt reference` prints all of the above in one go, plus the concepts shared by every command: config files, sites, `--dev`, placeholders, environment overrides and exit codes.
4. `jolt config` shows the values Jolt resolved for this repo. Add `--format json` for machine-readable output. Check it before assuming what a config key is set to.

Older versions of Jolt Scripts don't have `jolt --help` or `jolt reference`. `jolt <command> --help` works on every version.

## Before you run something

- Use the jolt command for a task if one exists (build, tag, push, deploy, DB dump, log tail) instead of calling `docker` or `aws` yourself. The command applies the repo's config for image names, regions and clusters.
- Read a command's help before running anything that changes shared or production resources: deploys, S3 sync, CloudFront invalidation, CodeBuild, Nexcess deploys. Tell the user what it will change first.
- Exit code 4 (missing tool) and 5 (missing config) mean something needs fixing. Don't set `JOLT_IGNORE_REQUIRED_COMMANDS` or `JOLT_IGNORE_REQUIRED_CONFIG` to get past them.
- If a command you need isn't listed by `jolt --help`, it doesn't exist.

## Common workflows

- Fresh checkout: `jolt prepare`.
- Reset the local database: `jolt db reset`, then `jolt db await` if something needs the database straight away.
- WordPress updates: `jolt wp update` makes a `joltWpUpdate/<date>` branch with one commit per update and doesn't push. Review with `jolt wp update modify`, merge with `jolt wp update merge`, tidy with `jolt wp update clean --dry-run` first.
- Ship an image: `jolt docker build`, `tag`, `login`, `push`, then `jolt aws ecs deploy`.
- Check a deployment: `jolt aws status` (add `--format json` for scripts) and `jolt aws logs tail <group> --clean`.
