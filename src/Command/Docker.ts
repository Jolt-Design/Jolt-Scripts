import ansis from 'ansis'
import { Command, Option } from 'clipanion'
import { ExecaError, execa } from 'execa'
import { execC, which } from '../utils.js'
import JoltCommand from './JoltCommand.js'

const notEmpty = (x: string) => x !== ''

export abstract class DockerCommand extends JoltCommand {
  requiredCommands = ['docker']
  dev = Option.Boolean('--dev', false, { description: 'Use development configuration' })
}

export class DockerCombinedCommand extends DockerCommand {
  static paths = [['docker', 'combined']]

  static usage = Command.Usage({
    category: 'Docker',
    description: 'Build and tag the image, and with --deploy also log in, push and deploy to ECS',
    details: `
      Runs \`docker build\` then \`docker tag\`. With \`--deploy\` it continues with \`docker login\`, \`docker push\`
      and \`aws ecs deploy\`. Always returns 0, even if a step fails, so check the output.
    `,
    examples: [
      ['Build and tag only', '$0 docker combined'],
      ['Build, push and deploy the dev environment', '$0 docker combined --dev --deploy'],
    ],
  })

  deploy = Option.Boolean('--deploy', { description: 'Also deploy to AWS ECS after building and pushing' })

  async command(): Promise<number | undefined> {
    const { cli, context, deploy, dev } = this
    const devArg = dev ? '--dev' : ''

    await cli.run(['docker', 'build', devArg].filter(notEmpty), context)
    await cli.run(['docker', 'tag', devArg].filter(notEmpty), context)

    if (deploy) {
      await cli.run(['docker', 'login'], context)
      await cli.run(['docker', 'push', devArg].filter(notEmpty), context)
      await cli.run(['aws', 'ecs', 'deploy', devArg].filter(notEmpty), context)
    }

    return 0
  }
}

export class DockerBuildCommand extends DockerCommand {
  static paths = [['docker', 'build']]

  static usage = Command.Usage({
    category: 'Docker',
    description: 'Build the project image with `docker buildx build`',
    details: `
      Tags the image with the configured \`imageName\` (a dev variant with \`--dev\`, which also passes
      \`--build-arg=DEVBUILD=1\`). Uses \`buildPlatform\`, \`buildContext\`, the Dockerfile path and \`dockerBuildArgs\`
      from config. Extra arguments are passed to buildx after placeholder resolution.

      Exit codes: 1 if \`imageName\` isn't configured, 2 if docker isn't installed.
    `,
    examples: [
      ['Build the production image', '$0 docker build'],
      ['Build the dev image without cache', '$0 docker build --dev --no-cache'],
    ],
  })

  args = Option.Proxy()

  getProxyArgs(): string[] {
    return this.args
  }

  async command(): Promise<number | undefined> {
    const {
      config,
      context,
      context: { stdout, stderr },
      dev,
    } = this

    const imageName = await config.getDockerImageName(dev)
    const imageType = dev ? 'dev' : 'prod'
    const dockerCommand = await config.command('docker')

    if (!imageName) {
      stderr.write(ansis.red('🐳 Image name must be configured!\n'))
      return 1
    }

    if (!(await which(dockerCommand))) {
      stderr.write(ansis.red(`🐳 Could not find command ${dockerCommand}!\n`))
      return 2
    }

    stdout.write(ansis.blue(`🐳 Building image ${imageName} for ${imageType} using ${dockerCommand}...\n`))

    const args = await this.buildCommandArgs()
    const command = [dockerCommand, ...args].join(' ')
    stdout.write(`Running command: ${config.redact(command)}\n`)

    const result = await execC(dockerCommand, args, { context })

    return result.exitCode
  }

  async buildCommandArgs(): Promise<string[]> {
    const { args, config, dev } = this

    // Include backwards compat for old --no-provenance config
    const parsedArgsPromises = args.map((x) => (x === '--no-provenance' ? '--provenance=false' : config.parseArg(x)))
    const parsedArgs = await Promise.all(parsedArgsPromises)
    const imageName = await config.getDockerImageName(dev)
    const platform = await config.get('buildPlatform')
    const context = await config.get('buildContext')
    const configuredBuildArgs = await this.getConfiguredBuildArgsAsStrings()
    const dockerFile = await config.getDockerfilePath()
    const devBuildArg = dev ? '--build-arg=DEVBUILD=1' : ''
    const allBuildArgs = [devBuildArg, ...configuredBuildArgs, ...parsedArgs]

    return [
      'buildx',
      'build',
      platform && `--platform=${platform}`,
      dockerFile && `-f ${dockerFile}`,
      `-t ${imageName}`,
      ...allBuildArgs,
      context ?? '.',
    ]
      .filter((x) => !!x)
      .map(String)
  }

  private async getConfiguredBuildArgsAsStrings(): Promise<string[]> {
    const { config } = this
    const buildArgs = await config.get('dockerBuildArgs')

    if (!buildArgs) {
      return []
    }

    return Object.entries(buildArgs).map(([k, v]) => `--build-arg=${k}=${v}`)
  }
}

export class DockerLoginCommand extends DockerCommand {
  static paths = [['docker', 'login']]

  static usage = Command.Usage({
    category: 'Docker',
    description: 'Log in to the ECR repository',
    details: `
      Gets a login password with the AWS CLI and passes it to \`docker login\`. The ECR URLs come from \`ecrRepoUrl\`
      and \`ecrBaseUrl\`, falling back to the Terraform outputs \`ecr_repo_url\` and \`ecr_base_url\`. The region is
      taken from the repo URL, then \`awsRegion\`, then Terraform.

      Requires aws and docker.
    `,
    examples: [['Log in to ECR', '$0 docker login']],
  })

  requiredCommands = ['aws', 'docker']

  async command(): Promise<number | undefined> {
    const {
      config,
      context: { stdout, stderr },
    } = this

    // First try to get the ECR repo URL and base URL
    const ecrRepoUrl = await config.get('ecrRepoUrl').then((url) => url ?? config.tfVar('ecr_repo_url'))
    const ecrBaseUrl = await config.get('ecrBaseUrl').then((url) => url ?? config.tfVar('ecr_base_url'))

    // Try to extract region from ECR repo URL first
    let region = null

    if (ecrRepoUrl) {
      const match = ecrRepoUrl.match(/dkr\.ecr\.([^.]+)\.amazonaws\.com/)
      if (match) {
        region = match[1]
      }
    }

    // Fall back to other region sources if we couldn't extract it from URL
    if (!region) {
      const awsRegion = await config.get('awsRegion')

      if (awsRegion) {
        region = awsRegion
      } else {
        const tfRegion = await config.tfVar('region')

        if (tfRegion) {
          region = tfRegion
        } else {
          region = await config.awsRegion()
        }
      }
    }

    stdout.write(ansis.blue(`🐳 Logging in to ECR repository ${ecrBaseUrl} on ${region}...\n`))

    try {
      const result = await execa(await config.command('aws'), ['ecr', 'get-login-password', '--region', region]).pipe(
        await config.command('docker'),
        ['login', '--username', 'AWS', '--password-stdin', ecrBaseUrl],
        { stdout, stderr },
      )

      return result.exitCode
    } catch (e) {
      if (e instanceof ExecaError) {
        stderr.write(ansis.red(`🐳 Failed to log in! Reason: ${e.message}\n`))
        return e.exitCode
      }

      throw e
    }
  }
}

export class DockerTagCommand extends DockerCommand {
  static paths = [['docker', 'tag']]

  static usage = Command.Usage({
    category: 'Docker',
    description: 'Tag the local image for the remote repository',
    details: `
      Tags \`<imageName>:latest\` as \`<remote repo>:<tag>\`; the tag defaults to \`latest\`. Unless \`--no-git-tag\` is
      given, also tags the image with the first 8 characters of the current commit SHA.

      Exit codes: 1 if \`imageName\` isn't configured, 2 if docker isn't installed.
    `,
    examples: [
      ['Tag as latest and with the commit SHA', '$0 docker tag'],
      ['Tag a release without the SHA tag', '$0 docker tag --no-git-tag v1.2.0'],
    ],
  })

  gitTag = Option.Boolean('--git-tag', true, { description: 'Also tag the image with the current Git commit SHA' })
  tag = Option.String({ required: false })

  async command(): Promise<number | undefined> {
    const {
      cli,
      config,
      dev,
      context,
      context: { stdout, stderr },
      gitTag,
      tag,
    } = this

    const dockerCommand = await config.command('docker')
    const imageName = await config.getDockerImageName(dev)
    const remoteRepo = await config.getRemoteRepo(dev)
    const localTag = 'latest'
    const remoteTag = tag ?? 'latest'
    const args = ['tag', `${imageName}:${localTag}`, `${remoteRepo}:${remoteTag}`]

    if (!imageName) {
      stderr.write(ansis.red('🐳 Image name must be configured!\n'))
      return 1
    }

    if (!(await which(dockerCommand))) {
      stderr.write(ansis.red(`🐳 Could not find command ${dockerCommand}!\n`))
      return 2
    }

    stdout.write(ansis.blue(`🐳 Tagging image ${imageName}:${localTag} as ${remoteRepo}:${remoteTag}...\n`))

    const result = await execC(dockerCommand, args, { context })

    if (gitTag) {
      const gitCommand = await config.command('git')

      if (gitCommand) {
        const commitShaResult = await execC(gitCommand, ['rev-parse', 'HEAD'], { shell: false, reject: false, stderr })

        if (commitShaResult.failed) {
          stderr.write(ansis.yellow('🐳 Failed to find Git SHA.\n'))
        } else {
          const sha = commitShaResult.stdout?.toString()

          if (sha) {
            const shaTag = sha.slice(0, 8)
            await cli.run(['docker', 'tag', '--no-git-tag', shaTag])
          } else {
            stderr.write(ansis.yellow('🐳 Cannot tag image with Git SHA because the tag command returned nothing.\n'))
          }
        }
      } else {
        stderr.write(ansis.yellow('🐳 Cannot tag image with Git SHA because git command was not found.\n'))
      }
    }

    return result.exitCode
  }
}

export class DockerPushCommand extends DockerCommand {
  static paths = [['docker', 'push']]

  static usage = Command.Usage({
    category: 'Docker',
    description: 'Push the tagged image to the remote repository',
    details: `
      Pushes \`<remote repo>:<tag>\`; the tag defaults to \`latest\`. Unless \`--no-git-tag\` is given, also pushes the
      commit SHA tag created by \`docker tag\`. Run \`docker login\` first.

      Exit codes: 1 if no remote repo is configured, 2 if docker isn't installed.
    `,
    examples: [
      ['Push latest and the commit SHA tag', '$0 docker push'],
      ['Push the dev image', '$0 docker push --dev'],
    ],
  })

  gitTag = Option.Boolean('--git-tag', true, {
    description: 'Also push the image tagged with the current Git commit SHA',
  })
  tag = Option.String({ required: false })

  async command(): Promise<number | undefined> {
    const {
      cli,
      config,
      context,
      context: { stdout, stderr },
      dev,
      gitTag,
      tag,
    } = this

    const dockerCommand = await config.command('docker')
    const remoteRepo = await config.getRemoteRepo(dev)
    const remoteTag = tag ?? 'latest'

    const args = ['push', `${remoteRepo}:${remoteTag}`]

    if (!remoteRepo) {
      stderr.write(ansis.red('🐳 Remote repo must be configured!\n'))
      return 1
    }

    if (!(await which(dockerCommand))) {
      stderr.write(ansis.red(`🐳 Could not find command ${dockerCommand}!\n`))
      return 2
    }

    stdout.write(ansis.blue(`🐳 Pushing image ${remoteRepo}:${remoteTag}...\n`))
    const result = await execC(dockerCommand, args, { context })

    if (gitTag) {
      const gitCommand = await config.command('git')

      if (gitCommand) {
        const commitShaResult = await execC(gitCommand, ['rev-parse', 'HEAD'], { shell: false, reject: false, stderr })

        if (commitShaResult.failed) {
          stderr.write(ansis.yellow('🐳 Failed to find Git SHA.\n'))
        } else {
          const sha = commitShaResult.stdout?.toString()

          if (sha) {
            const shaTag = sha.slice(0, 8)
            await cli.run(['docker', 'push', '--no-git-tag', shaTag])
          } else {
            stderr.write(ansis.yellow('🐳 Cannot tag image with Git SHA because the tag command returned nothing.\n'))
          }
        }
      } else {
        stderr.write(ansis.yellow('🐳 Cannot tag image with Git SHA because git command was not found.\n'))
      }
    }

    return result.exitCode
  }
}

export class DockerManifestCommand extends DockerCommand {
  static paths = [['docker', 'manifest']]

  static usage = Command.Usage({
    category: 'Docker',
    description: "Print the digest of the remote image's manifest",
    details: `
      Logs in to ECR, builds the image (skip with \`--no-build\`), then inspects the remote repo with
      \`docker buildx imagetools\`. Only the digest goes to stdout, so it's safe to capture. Progress goes to stderr.

      Exits 1 if no digest is found.
    `,
    examples: [['Print the digest without rebuilding', '$0 docker manifest --no-build']],
  })

  build = Option.Boolean('--build', true, { description: 'Build the image before creating the manifest' })

  async command(): Promise<number | undefined> {
    const {
      build,
      cli,
      config,
      context: { stdout, stderr },
      dev,
    } = this

    const devArg = dev ? '--dev' : ''
    const remoteRepo = config.getRemoteRepo(dev)

    await cli.run(['docker', 'login', devArg].filter(notEmpty), { stdout: stderr })

    if (build) {
      await cli.run(['docker', 'build', devArg, '--no-provenance'].filter(notEmpty), { stdout: stderr })
    }

    const result = await execC(await config.command('docker'), [
      'buildx',
      'imagetools',
      'inspect',
      await remoteRepo,
      "--format='{{json .Manifest}}'",
    ])

    const json = JSON.parse(result.stdout?.toString() || '{}')

    if (json.digest) {
      stdout.write(`${json.digest}\n`)
      return 0
    }

    stderr.write(ansis.red("Couldn't find digest in command output!\n"))
    return 1
  }
}
