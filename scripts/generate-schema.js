#!/usr/bin/env node

import { writeFileSync } from 'node:fs'
import { toJSONSchema } from 'zod'
import { JoltConfigSchema } from '../dist/schemas.js'

// Generate JSON schema from Zod schema using the built-in method
const jsonSchema = toJSONSchema(JoltConfigSchema, {
  target: 'draft-7'
})

// Add $schema property to allow JSON files to reference the schema
jsonSchema.properties.$schema = {
  type: 'string',
  description: 'JSON Schema reference for IDE support'
}

// Fix required properties for prepareCommands - properties with defaults should not be required
function fixRequiredProperties(schema) {
  if (schema.type === 'object' && schema.properties && schema.required) {
    const newRequired = schema.required.filter(prop => {
      const propSchema = schema.properties[prop]

      // If property has a default value, it shouldn't be required
      return !propSchema || propSchema.default === undefined
    })

    if (newRequired.length !== schema.required.length) {
      schema.required = newRequired.length > 0 ? newRequired : undefined
    }
  }

  // Recursively fix nested schemas
  if (schema.properties) {
    Object.values(schema.properties).forEach(fixRequiredProperties)
  }

  if (schema.items) {
    if (Array.isArray(schema.items)) {
      schema.items.forEach(fixRequiredProperties)
    } else {
      fixRequiredProperties(schema.items)
    }
  }

  if (schema.anyOf) {
    schema.anyOf.forEach(fixRequiredProperties)
  }

  if (schema.oneOf) {
    schema.oneOf.forEach(fixRequiredProperties)
  }
}

fixRequiredProperties(jsonSchema)

// Override the schema metadata
jsonSchema.$id = 'https://github.com/Jolt-Design/jolt-scripts/schema/jolt-config.json'
jsonSchema.title = 'Jolt Scripts Configuration'
jsonSchema.description = 'Configuration schema for Jolt Scripts DevOps automation tool'

// Add examples to the schema
jsonSchema.examples = [
  {
    imageName: 'my-app',
    awsRegion: 'us-east-1',
    ecsCluster: 'production-cluster',
    ecsService: 'my-app-service',
    devEcsCluster: 'dev-cluster',
    devEcsService: 'my-app-dev-service',
    prepareCommands: [
      'yarn install',
      {
        cmd: 'yarn build',
        name: 'Build application',
        timing: 'normal',
      },
    ],
    sites: {
      staging: {
        ecsCluster: 'staging-cluster',
        ecsService: 'my-app-staging',
      },
    },
  },
]

// Write the JSON schema to file
writeFileSync('jolt-config.schema.json', JSON.stringify(jsonSchema, null, 2))

console.log('✅ Generated jolt-config.schema.json from Zod schema')
