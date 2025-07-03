type PackageJson = {
  name: string
  version: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  packageManager?: string

  // biome-ignore lint/suspicious/noExplicitAny: we don't know what might be in there
  [key: string]: any
}
