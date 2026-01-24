import fs from 'fs'
import path from 'path'
import { Compiler } from 'webpack'
import {
  Options,
  ServerFuncRegistry,
  buildRegistry,
  resolveFilePath,
  transformSourceFile,
  emitToJs,
  applyReplacements,
  generateCompilationId
} from './common'

export class ZeroComWebpackPlugin {
  private options: Options
  private compilationId: string
  private registry: ServerFuncRegistry = new Map()

  constructor(options: Options = {}) {
    this.options = { development: true, ...options }
    this.compilationId = generateCompilationId()
  }

  apply(compiler: Compiler) {
    const pluginName = ZeroComWebpackPlugin.name
    const { webpack } = compiler

    // Build registry before compilation
    compiler.hooks.beforeCompile.tap(pluginName, () => {
      buildRegistry(compiler.context, this.registry)
      console.log(`[ZeroComWebpackPlugin] Found ${this.registry.size} files with server functions`)
    })

    // Transform files during module resolution
    compiler.hooks.normalModuleFactory.tap(pluginName, (nmf) => {
      nmf.hooks.beforeResolve.tap(pluginName, (resolveData) => {
        if (!resolveData.request.startsWith('.') && !resolveData.request.startsWith('/')) return

        const resolvedPath = resolveFilePath(path.resolve(resolveData.context, resolveData.request))
        if (!resolvedPath || !fs.existsSync(resolvedPath)) return

        const content = fs.readFileSync(resolvedPath, 'utf8')
        const result = transformSourceFile(resolvedPath, content, this.registry)
        if (!result.transformed) return

        const jsContent = emitToJs(resolvedPath, result.content)
        resolveData.request = `data:text/javascript,${encodeURIComponent(jsContent)}`

        console.log(`[ZeroComWebpackPlugin] Transformed: ${path.relative(compiler.context, resolvedPath)}`)
      })
    })

    // Production: minify global names
    if (this.options.development) return

    const { RawSource } = webpack.sources
    compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: pluginName, stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE },
        (assets) => {
          for (const assetName in assets) {
            if (!assetName.endsWith('.js')) continue
            const source = String(assets[assetName].source())
            const newSource = applyReplacements(source, this.compilationId)
            if (newSource !== source) {
              compilation.updateAsset(assetName, new RawSource(newSource))
            }
          }
        }
      )
    })
  }
}
