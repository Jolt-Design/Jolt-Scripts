import { z } from 'zod'

export const PrepareTimingSchema = z.enum(['early', 'normal'])

export const PrepareCommandSchema = z.object({
  cmd: z.string().describe('Command to execute'),
  name: z.string().optional().describe('Display name for the command'),
  fail: z.boolean().optional().default(true).describe('Whether to fail if command returns non-zero exit code'),
  dir: z.string().optional().describe('Working directory for the command'),
  timing: PrepareTimingSchema.optional().default('normal').describe('When to run the command during preparation'),
})

export const PrepareCommandsSchema = z.array(
  z.union([z.string().describe('Simple command string'), PrepareCommandSchema]),
)

// Site-specific configuration schema
export const SiteConfigSchema = z.record(z.string(), z.string())

// Complete Jolt configuration schema
export const JoltConfigSchema = z
  .object({
    // AWS Configuration
    awsRegion: z.string().optional().describe('AWS region for operations').default('eu-west-1'),

    // Docker Configuration
    imageName: z.string().optional().describe('Docker image name for production builds'),
    devImageName: z
      .string()
      .optional()
      .describe('Docker image name for development builds (overrides imageName + dev suffix)'),
    devSuffix: z.string().optional().describe('Suffix to append to image name for development builds').default('-dev'),
    buildPlatform: z.string().optional().describe('Docker build platform (e.g., linux/amd64, linux/arm64)'),
    buildContext: z.string().optional().describe('Docker build context path').default('.'),
    ecrBaseUrl: z.string().optional().describe('ECR repository base URL'),

    // ECS Configuration
    ecsCluster: z.string().optional().describe('Production ECS cluster name'),
    devEcsCluster: z.string().optional().describe('Development ECS cluster name'),
    ecsService: z.string().optional().describe('Production ECS service name'),
    devEcsService: z.string().optional().describe('Development ECS service name'),

    // CodeBuild Configuration
    codebuildProject: z.string().optional().describe('Production CodeBuild project name'),
    devCodebuildProject: z.string().optional().describe('Development CodeBuild project name'),

    // CloudFront Configuration
    cloudfrontDistribution: z.string().optional().describe('CloudFront distribution ID for cache invalidation'),

    // SSH Configuration
    sshAccount: z.string().optional().describe('SSH account for production deployments (user@host format)'),
    devSshAccount: z.string().optional().describe('SSH account for development deployments (user@host format)'),
    sshPort: z.string().optional().describe('SSH port number').default('22'),
    liveFolder: z.string().optional().describe('Remote folder path for production deployments'),
    devFolder: z.string().optional().describe('Remote folder path for development deployments'),

    // Git Configuration
    branch: z.string().optional().describe('Git branch for production deployments'),
    devBranch: z.string().optional().describe('Git branch for development deployments'),
    repo: z.string().optional().describe('Git repository URL'),
    codeSubfolder: z.string().optional().describe('Subfolder within repository containing the code'),

    // Nexcess Configuration
    nexcessDeployScript: z
      .string()
      .optional()
      .describe('Path to Nexcess deployment script')
      .default('bin/nexcess-deploy-script.sh'),
    nexcessCleanupScript: z
      .string()
      .optional()
      .describe('Path to Nexcess cleanup script')
      .default('bin/nexcess-cleanup.sh'),

    // Database Configuration
    dbSeed: z.string().optional().describe('Database seed file path'),
    dbBackupPath: z.string().optional().describe('Path for database backups'),

    // WordPress Configuration
    devPlugins: z.string().optional().describe('WordPress plugins to activate in development'),
    devPluginDelay: z.string().optional().describe('Delay in seconds before activating dev plugins').default('30'),
    wpCliContainer: z.string().optional().describe('Docker container name for WP-CLI operations'),
    wpCliContainerProfile: z.string().optional().describe('Docker Compose profile for WP-CLI container'),

    // Command Overrides
    dockerCommand: z.string().optional().describe('Override for docker command').default('docker'),
    composeCommand: z.string().optional().describe('Override for docker compose command').default('docker compose'),
    terraformCommand: z
      .string()
      .optional()
      .describe('Override for terraform/tofu command (auto-detects tofu vs terraform)'),
    nodeCommand: z.string().optional().describe('Override for node command').default('node'),
    yarnCommand: z.string().optional().describe('Override for yarn command').default('yarn'),
    awsCommand: z.string().optional().describe('Override for aws command').default('aws'),
    sshCommand: z.string().optional().describe('Override for ssh command').default('ssh'),
    rsyncCommand: z.string().optional().describe('Override for rsync command').default('rsync'),
    gitCommand: z.string().optional().describe('Override for git command').default('git'),
    gzipCommand: z.string().optional().describe('Override for gzip command').default('gzip'),

    // Prepare Commands
    prepareCommands: PrepareCommandsSchema.optional().describe('Commands to run during preparation phase'),

    // Site-specific configurations
    sites: z.record(z.string(), SiteConfigSchema).optional().describe('Site-specific configuration overrides'),
  })
  .catchall(z.string()) // Allow additional string properties for custom config values
