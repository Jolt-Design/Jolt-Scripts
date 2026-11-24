import { Command } from 'clipanion'

const concepts = `
CONCEPTS

Config
  Jolt reads the first existing, non-empty file from .jolt.json, ./bin/.env and .env. Files are not merged.
  Run \`jolt config\` to see every resolved value and command, or \`jolt config --format json\` for machine-readable
  output. Run \`jolt config init\` to create .jolt.json with a $schema reference for editor autocompletion.

Sites
  Config can define per-site overrides under "sites". Every command accepts --site <name> (-s) to pick one, or
  --for-each-site [series|parallel] (-x) to run once per site. The two are mutually exclusive. "defaultSite" sets the
  site used when neither is given. \`jolt config sites\` lists the site names.

Templating
  Config values and many arguments can contain {type:variable} placeholders. Types: arg, param, cmd, db,
  tf/tofu/terraform, conf/config, git, site. For example {tf:cluster_name}, {config:imageName} or {cmd:docker}.

Dev and prod
  Commands with --dev use the development variants of config keys, image tags, ECS clusters and so on.

Pass-through commands
  ssh, rsync, cmd, docker build and wp cli pass everything after the command name to the tool they wrap, so put
  jolt's own options before it: \`jolt --dev ssh ls\`, \`jolt --site shop rsync …\`. A jolt option straight after the
  command name is rejected rather than passed on. -h or --help straight after it shows the command's help.

External command overrides
  Each external tool can be replaced with an environment variable (JOLT_<NAME> first, then <NAME>) or a camelCase
  config key. Names: DOCKER_COMMAND, COMPOSE_COMMAND, TERRAFORM_COMMAND, NODE_COMMAND, YARN_COMMAND, AWS_COMMAND,
  SSH_COMMAND, RSYNC_COMMAND, GIT_COMMAND, GZIP_COMMAND.

Skipping pre-run checks
  JOLT_IGNORE_REQUIRED_COMMANDS and JOLT_IGNORE_REQUIRED_CONFIG skip the checks described under EXIT CODES.

EXIT CODES

  0  Success.
  4  A required external command (for example docker or aws) is not installed.
  5  Required config keys are missing. The missing keys are listed on stderr.
  Other non-zero codes are specific to each command. 1 is a general failure.
`

export class ReferenceCommand extends Command {
  static paths = [['reference']]

  static usage = Command.Usage({
    category: 'Jolt',
    description: 'Print the full reference for every command, with options, requirements and examples',
    details: `
      Prints every command's help in one go, followed by the concepts that apply to all commands: config files,
      sites, templating and exit codes. Use this instead of reading the source code.

      For one command, use \`jolt <command> --help\`.
    `,
    examples: [['Print the full reference', '$0 reference']],
  })

  async execute(): Promise<number | undefined> {
    const { stdout } = this.context

    stdout.write(this.cli.usage(null, { detailed: true }))
    stdout.write(`${concepts}\n`)

    return 0
  }
}
