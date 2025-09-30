# jolt-scripts

A TypeScript CLI tool that provides DevOps automation commands for WordPress/Docker development and AWS deployment workflows.

## Configuration

Jolt Scripts supports configuration through multiple sources (in order of precedence):
1. `.jolt.json` (JSON format)
2. `./bin/.env` (Environment variables)
3. `.env` (Environment variables)

### JSON Schema

A JSON schema is automatically generated from the Zod schema at `jolt-config.schema.json` for IDE autocompletion and validation. The schema is regenerated automatically when building the project. You can reference it in your `.jolt.json` file:

```json
{
  "$schema": "./node_modules/@joltdesign/scripts/jolt-config.schema.json",
  "imageName": "my-app",
  "awsRegion": "us-east-1",
  "ecsCluster": "production-cluster"
}
```

### Configuration Properties

The configuration supports the following properties:

#### AWS Configuration
- `awsRegion`: AWS region for operations (default: "eu-west-1")
- `ecsCluster`/`devEcsCluster`: ECS cluster names for production/development
- `ecsService`/`devEcsService`: ECS service names for production/development
- `codebuildProject`/`devCodebuildProject`: CodeBuild project names
- `cloudfrontDistribution`: CloudFront distribution ID

#### Docker Configuration
- `imageName`: Docker image name for production builds
- `devImageName`: Docker image name for development (overrides imageName + dev suffix)
- `buildPlatform`: Docker build platform (e.g., "linux/amd64")
- `buildContext`: Docker build context path (default: ".")
- `ecrBaseUrl`: ECR repository base URL

#### SSH & Deployment Configuration
- `sshAccount`/`devSshAccount`: SSH accounts for deployments (user@host format)
- `sshPort`: SSH port number (default: "22")
- `liveFolder`/`devFolder`: Remote folder paths for deployments
- `branch`/`devBranch`: Git branches for deployments
- `repo`: Git repository URL

#### Site-Specific Configuration
Use the `sites` object to define site-specific overrides:

```json
{
  "ecsCluster": "production-cluster",
  "sites": {
    "staging": {
      "ecsCluster": "staging-cluster",
      "ecsService": "my-app-staging"
    }
  }
}
```

#### Command Overrides
Override external tool commands:
- `dockerCommand`, `composeCommand`, `terraformCommand`
- `nodeCommand`, `yarnCommand`, `awsCommand`
- `sshCommand`, `rsyncCommand`, `gitCommand`, `gzipCommand`

#### Prepare Commands
Define preparation commands to run before builds:

```json
{
  "prepareCommands": [
    "yarn install",
    {
      "cmd": "yarn build",
      "name": "Build application",
      "timing": "normal",
      "fail": true
    }
  ]
}
```
