import type { z } from 'zod'
import type {
  JoltConfigSchema,
  PrepareCommandSchema,
  PrepareTimingSchema,
  SiteConfigSchema,
  WordPressConfigSchema,
} from '../schemas.js'
import type { ComposeService } from './compose.js'

export type PrepareTimingOption = z.infer<typeof PrepareTimingSchema>

export type PrepareCommandConfig = z.infer<typeof PrepareCommandSchema>

export type SiteConfig = z.infer<typeof SiteConfigSchema>

export type WordPressUpdatesConfig = z.infer<typeof JoltConfigSchema>['wpUpdates']

export type ConfigEntry =
  | string
  | Array<string | PrepareCommandConfig>
  | Record<string, SiteConfig>
  | WordPressUpdatesConfig

export type WordPressConfig = z.infer<typeof WordPressConfigSchema>

export type InternalConfig = Partial<z.infer<typeof JoltConfigSchema>>

export type CommandOverride = {
  command: string
  source: string
  sourceType: string
}

export type DBContainerInfo = {
  name: string | undefined
  type: 'mysql' | 'mariadb'
  service: ComposeService
  adminCommand: string | undefined
  cliCommand: string | undefined
  dumpCommand: string | undefined
  credentials: {
    db: string | undefined
    user: string | undefined
    pass: string | undefined
  }
}

export type TerraformOutputJson = {
  sensitive: boolean
  type: string
  // TODO: Not necessarily a string - could be an object
  value: string
}
