import type { LoaderContext } from 'webpack'
import {
  ServerFuncRegistry,
  transformSourceFile,
  emitToJs
} from './common'

export interface ZeroComLoaderOptions {
  registry: ServerFuncRegistry
}

export default function zeroComLoader(this: LoaderContext<ZeroComLoaderOptions>, source: string): string {
  const options = this.getOptions()
  const filePath = this.resourcePath

  const result = transformSourceFile(filePath, source, options.registry)
  if (!result.transformed) {
    return source
  }

  const jsContent = emitToJs(filePath, result.content)
  console.log(`[ZeroComWebpackPlugin] Transformed: ${filePath}`)
  return jsContent
}
