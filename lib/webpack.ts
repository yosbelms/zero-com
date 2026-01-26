import { Compiler, RuleSetRule } from 'webpack'
import {
  Options,
  ServerFuncRegistry,
  buildRegistry,
  applyReplacements,
  generateCompilationId,
  FILE_EXTENSIONS
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

    // Add loader rule for TypeScript/JavaScript files
    const loaderPath = require.resolve('./webpack-loader')
    const loaderRule: RuleSetRule = {
      test: new RegExp(`\\.(${FILE_EXTENSIONS.slice(1).map(e => e.slice(1)).join('|')})$`),
      exclude: /node_modules/,
      enforce: 'pre',
      use: [{
        loader: loaderPath,
        options: { registry: this.registry, development: this.options.development }
      }]
    }

    compiler.options.module.rules.unshift(loaderRule)

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
