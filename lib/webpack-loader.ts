import type { LoaderContext } from 'webpack'
import path from 'path'
import { Project } from 'ts-morph'
import {
  ServerFuncRegistry,
  transformSourceFile,
  mightNeedTransform,
} from './common'

export interface ZeroComLoaderOptions {
  registry: ServerFuncRegistry
  project?: Project
  development: boolean
  target?: 'client' | 'server'
}

export default function zeroComLoader(this: LoaderContext<ZeroComLoaderOptions>, source: string): void {
  const options = this.getOptions()
  const filePath = this.resourcePath

  if (!mightNeedTransform(source, filePath, options.registry)) {
    this.callback(null, source)
    return
  }

  const result = transformSourceFile(filePath, source, options.registry, {
    development: options.development,
    target: options.target
  }, options.project)
  if (!result.transformed) {
    this.callback(null, source)
    return
  }

  console.log(`[ZeroComWebpackPlugin] Transformed: ${path.basename(filePath)}`)
  this.callback(null, result.content, result.map as any)
}
