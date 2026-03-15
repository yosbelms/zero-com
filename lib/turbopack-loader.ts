import type { LoaderContext } from 'webpack'
import path from 'path'
import { Project } from 'ts-morph'
import {
  ServerFuncRegistry,
  buildRegistry,
  transformSourceFile,
  mightNeedTransform,
  createProject,
} from './common'

export interface TurbopackLoaderOptions {
  development?: boolean
  rootDir?: string
  target?: 'client' | 'server'
}

// Module-level cache: registry and project are built once and reused across invocations
let cachedRegistry: ServerFuncRegistry | null = null
let cachedRootDir: string | null = null
let cachedProject: Project | null = null

export default function turbopackLoader(this: LoaderContext<TurbopackLoaderOptions>, source: string): void {
  const options = this.getOptions()
  const filePath = this.resourcePath
  const rootDir = options.rootDir || this.rootContext || process.cwd()
  const development = options.development ?? true

  // Lazily build and cache the registry on first invocation or if rootDir changes
  if (!cachedRegistry || cachedRootDir !== rootDir) {
    cachedProject = createProject()
    cachedRegistry = new Map()
    cachedRootDir = rootDir
    buildRegistry(rootDir, cachedRegistry, cachedProject)
    for (const fileRegistry of cachedRegistry.values()) {
      for (const info of fileRegistry.values()) {
        console.log(`[TurbopackLoader] ${info.funcId}`)
      }
    }
  }

  if (!mightNeedTransform(source, filePath, cachedRegistry)) {
    this.callback(null, source)
    return
  }

  const result = transformSourceFile(filePath, source, cachedRegistry, { development, target: options.target }, cachedProject ?? undefined)

  if (!result.transformed) {
    this.callback(null, source)
    return
  }

  console.log(`[TurbopackLoader] Transformed: ${path.basename(filePath)}`)
  this.callback(null, result.content, result.map as any)
}
