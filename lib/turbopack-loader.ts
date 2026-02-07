import type { LoaderContext } from 'webpack'
import path from 'path'
import {
  ServerFuncRegistry,
  buildRegistry,
  transformSourceFile
} from './common'

export interface TurbopackLoaderOptions {
  development?: boolean
  rootDir?: string
}

// Module-level cache: registry is built once and reused across invocations
let cachedRegistry: ServerFuncRegistry | null = null
let cachedRootDir: string | null = null


export default function turbopackLoader(this: LoaderContext<TurbopackLoaderOptions>, source: string): void {
  const options = this.getOptions()
  const filePath = this.resourcePath
  const rootDir = options.rootDir || this.rootContext || process.cwd()
  const development = options.development ?? true

  // Lazily build and cache the registry on first invocation or if rootDir changes
  if (!cachedRegistry || cachedRootDir !== rootDir) {
    cachedRegistry = new Map()
    cachedRootDir = rootDir
    buildRegistry(rootDir, cachedRegistry)
    console.log(`[TurbopackLoader] Found ${cachedRegistry.size} files with server functions`)
  }

  const result = transformSourceFile(filePath, source, cachedRegistry, { development })

  if (!result.transformed) {
    this.callback(null, source)
    return
  }

  console.log(`[TurbopackLoader] Transformed: ${path.basename(filePath)}`)
  this.callback(null, result.content, result.map as any)
}
