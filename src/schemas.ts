import { z } from 'zod'

export const PrepareTimingSchema = z.enum(['early', 'normal'])

export const PrepareCommandSchema = z.object({
  cmd: z.string(),
  name: z.string().optional(),
  fail: z.boolean().optional().default(true),
  dir: z.string().optional(),
  timing: PrepareTimingSchema.optional().default('normal'),
})

export const PrepareCommandsSchema = z.array(z.union([z.string(), PrepareCommandSchema]))
