import { Compiler, RuleSetRule } from 'webpack'
import {
  Options,
  ServerFuncRegistry,
  buildRegistry,
  updateRegistryForFile,
  applyReplacements,
  generateCompilationId,
  createProject,
  FILE_EXTENSIONS
} from './common'
import { Project } from 'ts-morph'

export class ZeroComWebpackPlugin {
  private options: Options
  private compilationId: string
  private registry: ServerFuncRegistry = new Map()
  private project: Project = createProject()

  constructor(options: Options = {}) {
    this.options = { development: true, ...options }
    this.compilationId = generateCompilationId()
  }

  apply(compiler: Compiler) {
    const pluginName = ZeroComWebpackPlugin.name
    const { webpack } = compiler
    const contextDir = this.options.contextDir ?? compiler.context

    // Build registry before compilation
    compiler.hooks.beforeCompile.tap(pluginName, () => {
      buildRegistry(contextDir, this.registry, this.project)
      for (const fileRegistry of this.registry.values()) {
        for (const info of fileRegistry.values()) {
          console.log(`[ZeroComWebpackPlugin] ${info.funcId}`)
        }
      }
    })

    // Incrementally update registry when a file changes during watch mode
    compiler.hooks.invalid.tap(pluginName, (fileName) => {
      if (fileName) updateRegistryForFile(fileName, contextDir, this.registry, this.project)
    })

    // Add loader rule for TypeScript/JavaScript files
    const loaderPath = require.resolve('./webpack-loader')
    const loaderRule: RuleSetRule = {
      test: new RegExp(`\\.(${FILE_EXTENSIONS.slice(1).map(e => e.slice(1)).join('|')})$`),
      exclude: /node_modules/,
      enforce: 'pre',
      use: [{
        loader: loaderPath,
        options: { registry: this.registry, project: this.project, development: this.options.development, target: this.options.target }
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
