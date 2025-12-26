import fs from 'fs'
import { minimatch } from 'minimatch'
import path from 'path'
import { ArrowFunction, CallExpression, Project } from 'ts-morph'
import ts from 'typescript'
import {
  Plugin,
  PluginContext,
  ResolveIdResult,
  LoadResult,
  NormalizedOutputOptions,
  RenderedChunk
} from 'rollup'
import { Options, ZERO_COM_CLIENT_SEND, ZERO_COM_SERVER_REGISTRY, formatFuncIdName } from './common'

export function zeroComRollupPlugin(options: Options): Plugin {
  const { development = true, patterns } = options
  const compilationId = String(Math.floor(Math.random() * 1000000))
  const clientPattern = patterns.client
  const serverPattern = patterns.server

  const replacements = [
    { target: ZERO_COM_CLIENT_SEND, replacement: `__ZERO_COM_CLIENT_SEND_${compilationId}` },
    { target: ZERO_COM_SERVER_REGISTRY, replacement: `__ZERO_COM_SERVER_REGISTRY_${compilationId}` }
  ]

  return {
    name: 'zero-com-rollup-plugin',

    async resolveId(this: PluginContext, source: string, importer: string | undefined, options: { isEntry: boolean }): Promise<ResolveIdResult> {
      if (!importer) return null

      const resolveResult = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolveResult) return null

      const absolutePath = resolveResult.id
      const isServerFile = minimatch(absolutePath, path.join(process.cwd(), serverPattern))
      if (!isServerFile) return null

      const requestedFromClient = minimatch(importer, path.join(process.cwd(), clientPattern))

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
        return null
      }

      return {
        id: resolvedPath,
        meta: {
          isClient: requestedFromClient,
        }
      }
    },

    load(this: PluginContext, id: string): LoadResult {
      const meta = this.getModuleInfo(id)?.meta
      if (meta === undefined || meta.isClient === undefined) return null

      const originalContent = fs.readFileSync(id, 'utf8')
      const project = new Project({
        compilerOptions: {
          target: ts.ScriptTarget.ES2017,
          module: ts.ModuleKind.ESNext,
        },
      })

      const sourceFile = project.createSourceFile(id, originalContent, { overwrite: true })

      if (meta.isClient) {
        sourceFile.getFunctions().forEach(func => {
          if (func.isExported() && func.isAsync()) {
            const funcName = String(func.getName())
            const lineNumber = func.getStartLineNumber()
            const funcParams = func.getParameters().map(p => p.getName()).join(', ')
            const funcId = formatFuncIdName(funcName, path.relative(process.cwd(), id), lineNumber)
            const newFunctionBody = `return window.${ZERO_COM_CLIENT_SEND}({funcId: '${funcId}', params: [${funcParams}]})`
            func.setBodyText(newFunctionBody)
          }
        })
        sourceFile.getVariableDeclarations().forEach(decl => {
          const initializer = decl.getInitializer()
          if (!initializer || !decl.isExported()) return

          if (initializer instanceof ArrowFunction && initializer.isAsync()) {
            const funcName = decl.getName()
            const lineNumber = decl.getStartLineNumber()
            const funcParams = initializer.getParameters().map(p => p.getName()).join(', ')
            const funcId = formatFuncIdName(funcName, path.relative(process.cwd(), id), lineNumber)
            const newFunctionBody = `return window.${ZERO_COM_CLIENT_SEND}({funcId: '${funcId}', params: [${funcParams}]})`
            initializer.setBodyText(newFunctionBody)
          } else if (initializer.getKind() === ts.SyntaxKind.CallExpression && (initializer as CallExpression).getExpression().getText() === 'serverFn') {
            const call = initializer as CallExpression
            const arg = call.getArguments()[0]
            if (arg && arg instanceof ArrowFunction) {
              const funcName = decl.getName()
              const lineNumber = decl.getStartLineNumber()
              const funcParams = arg.getParameters().map(p => p.getName()).join(', ')
              const funcId = formatFuncIdName(funcName, path.relative(process.cwd(), id), lineNumber)
              const newFunctionBody = `return window.${ZERO_COM_CLIENT_SEND}({funcId: '${funcId}', params: [${funcParams}]})`
              
              // Create a new arrow function string
              const newArrowFunc = `(${funcParams}) => { ${newFunctionBody} }`
              
              // Replace the serverFn call with the new arrow function
              decl.setInitializer(newArrowFunc)
            }
          }
        })
      } else {
        const chunks: string[] = []
        sourceFile.getFunctions().forEach(func => {
          if (func.isExported() && func.isAsync()) {
            const funcName = String(func.getName())
            const lineNumber = func.getStartLineNumber()
            const funcId = formatFuncIdName(funcName, path.relative(process.cwd(), id), lineNumber)
            chunks.push(`global.${ZERO_COM_SERVER_REGISTRY}['${funcId}'] = ${funcName}`)
          }
        })
        sourceFile.getVariableDeclarations().forEach(decl => {
          const initializer = decl.getInitializer()
          if (initializer) {
            const isServerFn = initializer.getKind() === ts.SyntaxKind.CallExpression && (initializer as CallExpression).getExpression().getText() === 'serverFn'
            if (
              (initializer instanceof ArrowFunction && decl.isExported() && initializer.isAsync()) ||
              (isServerFn && decl.isExported())
            ) {
              const funcName = decl.getName()
              const lineNumber = decl.getStartLineNumber()
              const funcId = formatFuncIdName(funcName, path.relative(process.cwd(), id), lineNumber)
              chunks.push(`global.${ZERO_COM_SERVER_REGISTRY}['${funcId}'] = ${funcName}`)
            }
          }
        })

        if (chunks.length > 0) {
          const textToAdd = `\nif (!global.${ZERO_COM_SERVER_REGISTRY}) global.${ZERO_COM_SERVER_REGISTRY} = Object.create(null); ${chunks.join(',')}`
          sourceFile.insertText(sourceFile.getEnd(), textToAdd);
        }
      }

      const result = project.emitToMemory()
      const newContent = result.getFiles()[0].text
      return newContent
    },

    renderChunk(this: PluginContext, code: string, chunk: RenderedChunk, options: NormalizedOutputOptions) {
      if (development) return null

      let modified = false
      let newCode = code
      replacements.forEach(({ target, replacement }) => {
        if (newCode.includes(target)) {
          newCode = newCode.replaceAll(target, replacement)
          modified = true
        }
      })

      if (modified) {
        return { code: newCode, map: null }
      }

      return null
    }
  }
}
