import type { PathLike } from 'node:fs'
import { stat } from 'node:fs/promises'

export async function fileExists(path: PathLike): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (e) {
    return false
  }
}

export function constToCamel(key: string): string {
  let parts = key.split('_')
  parts = parts.map((x) => x.toLocaleLowerCase().replace(/^./, (y) => y.toLocaleUpperCase()))
  parts[0] = parts[0].toLocaleLowerCase()

  return parts.join('')
}
