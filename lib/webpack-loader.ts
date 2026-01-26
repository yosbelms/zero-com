import type { LoaderContext } from 'webpack'
import path from 'path'
import {
  ServerFuncRegistry,
  transformSourceFile
} from './common'

export interface ZeroComLoaderOptions {
  registry: ServerFuncRegistry
  development: boolean
}

export default function zeroComLoader(this: LoaderContext<ZeroComLoaderOptions>, source: string): void {
  const options = this.getOptions()
  const filePath = this.resourcePath

  const result = transformSourceFile(filePath, source, options.registry, {
    development: options.development
  })
  if (!result.transformed) {
    this.callback(null, source)
    return
  }

  console.log(`[ZeroComWebpackPlugin] Transformed: ${path.basename(filePath)}`)
  this.callback(null, result.content, result.map as any)
}
