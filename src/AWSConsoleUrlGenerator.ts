/**
 * AWS Console URL Generator
 *
 * Utility for generating AWS console URLs for various services
 */
export const AWSConsoleUrlGenerator = {
  /**
   * Generate ECS service console URL
   */
  ecsService(region: string, cluster: string, service: string): string {
    return `https://${region}.console.aws.amazon.com/ecs/v2/clusters/${cluster}/services/${service}`
  },

  /**
   * Generate ECS cluster console URL
   */
  ecsCluster(region: string, cluster: string): string {
    return `https://${region}.console.aws.amazon.com/ecs/v2/clusters/${cluster}`
  },

  /**
   * Generate S3 bucket console URL
   */
  s3Bucket(_region: string, bucket: string): string {
    return `https://s3.console.aws.amazon.com/s3/buckets/${bucket}`
  },

  /**
   * Generate CloudWatch log group console URL
   */
  cloudWatchLogGroup(region: string, logGroup: string): string {
    const encodedLogGroup = encodeURIComponent(logGroup)
    return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${encodedLogGroup}`
  },

  /**
   * Generate CodeBuild project console URL
   */
  codeBuildProject(region: string, projectName: string): string {
    return `https://${region}.console.aws.amazon.com/codesuite/codebuild/projects/${projectName}`
  },

  /**
   * Generate CodeBuild build console URL
   */
  codeBuildBuild(region: string, projectName: string, buildId: string): string {
    return `https://${region}.console.aws.amazon.com/codesuite/codebuild/projects/${projectName}/build/${buildId}`
  },

  /**
   * Generate CloudFront distribution console URL
   */
  cloudFrontDistribution(_region: string, distributionId: string): string {
    // CloudFront console is always in us-east-1 region but we include region for consistency
    return `https://console.aws.amazon.com/cloudfront/v3/home#/distributions/${distributionId}`
  },

  /**
   * Extract bucket name from S3 URI
   */
  extractS3Bucket(s3Uri: string): string | null {
    const match = s3Uri.match(/^s3:\/\/([^/]+)/)
    return match ? match[1] : null
  },
}
