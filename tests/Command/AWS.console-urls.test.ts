import { describe, expect, it } from 'vitest'
import { AWSConsoleUrlGenerator } from '../../src/AWSConsoleUrlGenerator.js'

describe('AWSConsoleUrlGenerator', () => {
  describe('ecsService', () => {
    it('should generate correct ECS service URL', () => {
      const url = AWSConsoleUrlGenerator.ecsService('us-east-1', 'my-cluster', 'my-service')
      expect(url).toBe('https://us-east-1.console.aws.amazon.com/ecs/v2/clusters/my-cluster/services/my-service')
    })
  })

  describe('ecsCluster', () => {
    it('should generate correct ECS cluster URL', () => {
      const url = AWSConsoleUrlGenerator.ecsCluster('eu-west-1', 'production-cluster')
      expect(url).toBe('https://eu-west-1.console.aws.amazon.com/ecs/v2/clusters/production-cluster')
    })
  })

  describe('s3Bucket', () => {
    it('should generate correct S3 bucket URL', () => {
      const url = AWSConsoleUrlGenerator.s3Bucket('us-east-1', 'my-bucket')
      expect(url).toBe('https://s3.console.aws.amazon.com/s3/buckets/my-bucket')
    })
  })

  describe('cloudWatchLogGroup', () => {
    it('should generate correct CloudWatch log group URL', () => {
      const url = AWSConsoleUrlGenerator.cloudWatchLogGroup('us-east-1', '/aws/lambda/my-function')
      expect(url).toBe(
        'https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group/%2Faws%2Flambda%2Fmy-function',
      )
    })

    it('should properly encode log group names with special characters', () => {
      const url = AWSConsoleUrlGenerator.cloudWatchLogGroup('us-east-1', '/aws/codebuild/project-name')
      expect(url).toBe(
        'https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group/%2Faws%2Fcodebuild%2Fproject-name',
      )
    })
  })

  describe('codeBuildProject', () => {
    it('should generate correct CodeBuild project URL', () => {
      const url = AWSConsoleUrlGenerator.codeBuildProject('us-east-1', 'my-build-project')
      expect(url).toBe('https://us-east-1.console.aws.amazon.com/codesuite/codebuild/projects/my-build-project')
    })
  })

  describe('codeBuildBuild', () => {
    it('should generate correct CodeBuild build URL', () => {
      const url = AWSConsoleUrlGenerator.codeBuildBuild(
        'us-east-1',
        'my-project',
        'my-project:12345678-abcd-1234-efgh-567890123456',
      )
      expect(url).toBe(
        'https://us-east-1.console.aws.amazon.com/codesuite/codebuild/projects/my-project/build/my-project:12345678-abcd-1234-efgh-567890123456',
      )
    })
  })

  describe('cloudFrontDistribution', () => {
    it('should generate correct CloudFront distribution URL', () => {
      const url = AWSConsoleUrlGenerator.cloudFrontDistribution('us-east-1', 'E1234567890ABC')
      expect(url).toBe('https://console.aws.amazon.com/cloudfront/v3/home#/distributions/E1234567890ABC')
    })
  })

  describe('extractS3Bucket', () => {
    it('should extract bucket name from S3 URI', () => {
      const bucket = AWSConsoleUrlGenerator.extractS3Bucket('s3://my-bucket/some/path')
      expect(bucket).toBe('my-bucket')
    })

    it('should extract bucket name from S3 URI without path', () => {
      const bucket = AWSConsoleUrlGenerator.extractS3Bucket('s3://my-bucket')
      expect(bucket).toBe('my-bucket')
    })

    it('should return null for non-S3 URI', () => {
      const bucket = AWSConsoleUrlGenerator.extractS3Bucket('/local/path')
      expect(bucket).toBeNull()
    })

    it('should return null for invalid S3 URI', () => {
      const bucket = AWSConsoleUrlGenerator.extractS3Bucket('https://example.com')
      expect(bucket).toBeNull()
    })
  })
})
