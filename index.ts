import fs from 'fs'
import { minimatch } from 'minimatch'
import path from 'path'
import { Project } from 'ts-morph'
import ts from 'typescript'
import { Compiler } from 'webpack'

type Options = {
  development?: boolean,
  patterns: {
    client: string,
    server: string,
  }
}

export type Message = {
  method: string,
  params: any[],
  [key: string]: any
}

export class ZeroComWebpackPlugin {
  private options: Options
  private compilationId: string
  private clientPattern: string
  private serverPattern: string

  constructor(options: Options) {
    this.options = {
      development: true,
      ...options,
      patterns: {
        ...options.patterns
      }
    }
    this.compilationId = String(Math.floor(Math.random() * 1000000))
    this.clientPattern = this.options.patterns.client
    this.serverPattern = this.options.patterns.server
  }

  apply(compiler: Compiler) {
    const ZERO_COM_CLIENT_SEND = 'ZERO_COM_CLIENT_SEND'
    const ZERO_COM_SERVER_REGISTRY = 'ZERO_COM_SERVER_REGISTRY'

    const pluginName = ZeroComWebpackPlugin.name
    const { webpack } = compiler
    const { RawSource } = webpack.sources

    compiler.hooks.normalModuleFactory.tap(pluginName, (nmf) => {
      nmf.hooks.beforeResolve.tap(pluginName, (resolveData) => {
        const absolutePath = path.resolve(resolveData.context, resolveData.request)
        const isServerFile = minimatch(absolutePath, path.join(compiler.context, this.serverPattern))
        if (!isServerFile) return

        const requestedFromClient = minimatch(resolveData.contextInfo.issuer, path.join(compiler.context, this.clientPattern))

        const tsPath = absolutePath + '.ts'
        const jsPath = absolutePath + '.js'
        const mjsPath = absolutePath + '.mjs'
        let resolvedPath = ''

        if (fs.existsSync(tsPath)) {
          resolvedPath = tsPath
        } else if (fs.existsSync(jsPath)) {
          resolvedPath = jsPath
        } else if (fs.existsSync(mjsPath)) {
          resolvedPath = mjsPath
        } else {
          throw new Error('Unable to resolve: ' + absolutePath)
        }

        const originalContent = fs.readFileSync(resolvedPath, 'utf8')

        const project = new Project({
          compilerOptions: {
            target: ts.ScriptTarget.ES2017,
            module: ts.ModuleKind.ESNext,
          },
        })

        const sourceFile = project.createSourceFile(absolutePath, originalContent, { overwrite: true })
        let newModuleContent = ''

        if (requestedFromClient) {
          const generatedFunctions: string[] = []
          sourceFile.getFunctions().forEach(func => {
            if (func.isExported() && func.isAsync()) {
              const funcName = String(func.getName())
              const lineNumber = func.getStartLineNumber()
              const funcParams = func.getParameters().map(p => p.getName()).join(', ')
              const method = formatMethodName(funcName, path.relative(compiler.context, absolutePath), lineNumber)
              const newFunctionBody = `return window.${ZERO_COM_CLIENT_SEND}({method: '${method}', params: [${funcParams}]})`
              func.setBodyText(newFunctionBody)
              generatedFunctions.push(func.getText())
              console.log('client:', method)
            }
          })
          newModuleContent = generatedFunctions.join('\n\n')
        } else {
          const chunks: string[] = []
          sourceFile.getFunctions().forEach(func => {
            if (func.isExported() && func.isAsync()) {
              const funcName = String(func.getName())
              const lineNumber = func.getStartLineNumber()
              const method = formatMethodName(funcName, path.relative(compiler.context, absolutePath), lineNumber)
              chunks.push(`global.${ZERO_COM_SERVER_REGISTRY}['${method}'] = ${funcName}`)
              console.log('server:', method)
            }
          })
          newModuleContent = `${originalContent} if (!global.${ZERO_COM_SERVER_REGISTRY}) global.${ZERO_COM_SERVER_REGISTRY} = Object.create(null); ${chunks.join(',')}`
        }

        project.createSourceFile(absolutePath + '.ts', newModuleContent, { overwrite: true })
        const result = project.emitToMemory()
        const newContent = result.getFiles()[0].text
        const inlineLoader = `data:text/javascript,${encodeURIComponent(newContent)}`
        resolveData.request = inlineLoader
      })
    })

    if (this.options.development) return

    const replacements = [
      { target: ZERO_COM_CLIENT_SEND, replacement: `__ZERO_COM_CLIENT_SEND_${this.compilationId}` },
      { target: ZERO_COM_SERVER_REGISTRY, replacement: `__ZERO_COM_SERVER_REGISTRY_${this.compilationId}` }
    ]

    compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
      compilation.hooks.processAssets.tap({ name: pluginName, stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE }, (assets) => {
        for (const assetName in assets) {
          if (assetName.endsWith('.js')) {
            let assetSource = String(assets[assetName].source())
            let modified = false
            replacements.forEach(({ target, replacement }) => {
              if (assetSource.includes(target)) {
                assetSource = assetSource.replaceAll(target, replacement)
                modified = true
              }
            })
            if (modified) {
              compilation.updateAsset(assetName, new RawSource(assetSource))
            }
          }
        }

      })
    })

  }
}

const formatMethodName = (funcName: string, path: string, line: number) => {
  return `${funcName}@${path}:${line}`
}
