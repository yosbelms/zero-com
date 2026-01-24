import fs from 'fs'
import path from 'path'
import { ArrowFunction, CallExpression, Identifier, Project, PropertyAccessExpression, SourceFile, SyntaxKind, ts } from 'ts-morph'

// Types
export type Options = {
  development?: boolean
}

export type ServerFuncInfo = {
  funcId: string
  filePath: string
  exportName: string
  requireContext: boolean
}

export type ServerFuncRegistry = Map<string, Map<string, ServerFuncInfo>>

// Constants
export const ZERO_COM_CLIENT_SEND = 'ZERO_COM_CLIENT_SEND'
export const ZERO_COM_SERVER_REGISTRY = 'ZERO_COM_SERVER_REGISTRY'
export const SERVER_FUNCTION_WRAPPER_NAME = 'func'
export const HANDLE_NAME = 'handle'
export const SEND_NAME = 'send'
export const EXEC_FUNC_NAME = 'execFunc'
export const CONTEXT_TYPE_NAME = 'context'
export const LIBRARY_NAME = 'zero-com'
export const FILE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs']

export const formatFuncIdName = (funcName: string, filePath: string, line: number): string => {
  return `${funcName}@${filePath}:${line}`
}

export const generateCompilationId = (): string => String(Math.floor(Math.random() * 1000000))

export const getReplacements = (compilationId: string) => [
  { target: ZERO_COM_CLIENT_SEND, replacement: `__ZERO_COM_CLIENT_SEND_${compilationId}` },
  { target: ZERO_COM_SERVER_REGISTRY, replacement: `__ZERO_COM_SERVER_REGISTRY_${compilationId}` }
]

// Utilities
export const isFromLibrary = (callExpr: CallExpression, libraryName: string): boolean => {
  const symbol = callExpr.getExpression().getSymbol()
  if (!symbol) return false

  for (const decl of symbol.getDeclarations()) {
    const kind = decl.getKind()
    if (kind === ts.SyntaxKind.ImportSpecifier || kind === ts.SyntaxKind.NamespaceImport) {
      const importDecl = decl.getFirstAncestorByKind(ts.SyntaxKind.ImportDeclaration)
      if (importDecl?.getModuleSpecifierValue() === libraryName) return true
    }
  }
  return false
}

export const resolveFilePath = (basePath: string): string => {
  for (const ext of FILE_EXTENSIONS) {
    const tryPath = basePath + ext
    if (fs.existsSync(tryPath)) return tryPath
  }
  for (const ext of FILE_EXTENSIONS.slice(1)) {
    const tryPath = path.join(basePath, 'index' + ext)
    if (fs.existsSync(tryPath)) return tryPath
  }
  return ''
}

export const createProject = (): Project => new Project({
  compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.ESNext }
})

const getCalleeName = (callExpr: CallExpression): string => {
  const expr = callExpr.getExpression()
  const kind = expr.getKind()
  if (kind === SyntaxKind.Identifier) return (expr as Identifier).getText()
  if (kind === SyntaxKind.PropertyAccessExpression) return (expr as PropertyAccessExpression).getName()
  return ''
}

const getCalleeFullName = (callExpr: CallExpression): string => {
  const expr = callExpr.getExpression()
  const kind = expr.getKind()
  if (kind === SyntaxKind.Identifier) return (expr as Identifier).getText()
  if (kind === SyntaxKind.PropertyAccessExpression) return (expr as PropertyAccessExpression).getText()
  return ''
}

// Registry building
export const buildRegistry = (contextDir: string, registry: ServerFuncRegistry): void => {
  registry.clear()
  const scanDirectory = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        scanDirectory(fullPath)
      } else if (entry.isFile() && FILE_EXTENSIONS.slice(1).includes(path.extname(entry.name))) {
        scanFileForServerFunctions(fullPath, contextDir, registry)
      }
    }
  }
  scanDirectory(contextDir)
}

const scanFileForServerFunctions = (filePath: string, contextDir: string, registry: ServerFuncRegistry): void => {
  const sourceFile = createProject().createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'), { overwrite: true })
  const fileRegistry = new Map<string, ServerFuncInfo>()

  for (const decl of sourceFile.getVariableDeclarations()) {
    if (!decl.isExported()) continue
    const initializer = decl.getInitializer()
    if (!initializer || initializer.getKind() !== SyntaxKind.CallExpression) continue

    const callExpr = initializer as CallExpression
    if (!isFromLibrary(callExpr, LIBRARY_NAME)) continue

    const funcExprText = callExpr.getExpression().getText()
    if (funcExprText !== SERVER_FUNCTION_WRAPPER_NAME && !funcExprText.endsWith(`.${SERVER_FUNCTION_WRAPPER_NAME}`)) continue

    const args = callExpr.getArguments()
    if (args.length !== 1 || args[0].getKind() !== SyntaxKind.ArrowFunction) continue

    const params = (args[0] as ArrowFunction).getParameters()
    const requireContext = params.length > 0 && params[0].getTypeNode()?.getText().startsWith(CONTEXT_TYPE_NAME) || false

    const exportName = decl.getName()
    fileRegistry.set(exportName, {
      funcId: formatFuncIdName(exportName, path.relative(contextDir, filePath), decl.getStartLineNumber()),
      filePath,
      exportName,
      requireContext,
    })
  }

  if (fileRegistry.size > 0) registry.set(filePath, fileRegistry)
}

// Imported functions resolution
export const getImportedServerFunctions = (sourceFile: SourceFile, registry: ServerFuncRegistry): Map<string, ServerFuncInfo> => {
  const importedFuncs = new Map<string, ServerFuncInfo>()

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue()
    if (!moduleSpecifier.startsWith('.')) continue

    const resolvedPath = resolveFilePath(path.resolve(path.dirname(sourceFile.getFilePath()), moduleSpecifier))
    const fileRegistry = registry.get(resolvedPath)
    if (!fileRegistry) continue

    for (const namedImport of importDecl.getNamedImports()) {
      const funcInfo = fileRegistry.get(namedImport.getName())
      if (funcInfo) importedFuncs.set(namedImport.getAliasNode()?.getText() || namedImport.getName(), funcInfo)
    }

    const nsImport = importDecl.getNamespaceImport()
    if (nsImport) {
      fileRegistry.forEach((info, name) => importedFuncs.set(`${nsImport.getText()}.${name}`, info))
    }
  }

  return importedFuncs
}

// Transformations
export const transformCallSites = (sourceFile: SourceFile, importedFuncs: Map<string, ServerFuncInfo>): boolean => {
  if (importedFuncs.size === 0) return false
  let modified = false

  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return
    const callExpr = node as CallExpression
    const calleeName = getCalleeFullName(callExpr)
    const funcInfo = importedFuncs.get(calleeName)
    if (!funcInfo) return

    const args = callExpr.getArguments().map(a => a.getText()).join(', ')
    callExpr.replaceWithText(`globalThis.${ZERO_COM_CLIENT_SEND}('${funcInfo.funcId}', [${args}])`)
    modified = true
  })

  return modified
}

export const transformHandleCalls = (sourceFile: SourceFile): boolean => {
  let modified = false

  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return
    const callExpr = node as CallExpression
    if (!isFromLibrary(callExpr, LIBRARY_NAME) || getCalleeName(callExpr) !== HANDLE_NAME) return

    const args = callExpr.getArguments()
    if (args.length < 3) return

    callExpr.replaceWithText(
      `${EXEC_FUNC_NAME}(globalThis.${ZERO_COM_SERVER_REGISTRY}[${args[0].getText()}], ${args[1].getText()}, ${args[2].getText()})`
    )
    modified = true
  })

  return modified
}

export const transformSendCalls = (sourceFile: SourceFile): boolean => {
  let modified = false

  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return
    const callExpr = node as CallExpression
    if (!isFromLibrary(callExpr, LIBRARY_NAME) || getCalleeName(callExpr) !== SEND_NAME) return

    const args = callExpr.getArguments()
    if (args.length < 1) return

    callExpr.replaceWithText(`globalThis.${ZERO_COM_CLIENT_SEND} = ${args[0].getText()}`)
    modified = true
  })

  return modified
}

export const appendRegistryCode = (sourceFile: SourceFile, fileRegistry: Map<string, ServerFuncInfo>): string => {
  const registrations = Array.from(fileRegistry.values())
    .map(info => `globalThis.${ZERO_COM_SERVER_REGISTRY}['${info.funcId}'] = ${info.exportName}`)
    .join(';\n')

  return `${sourceFile.getFullText()}
if (!globalThis.${ZERO_COM_SERVER_REGISTRY}) globalThis.${ZERO_COM_SERVER_REGISTRY} = Object.create(null);
${registrations};`
}

// Main transformation orchestrator
export type TransformResult = { content: string; transformed: boolean }

export const transformSourceFile = (
  filePath: string,
  content: string,
  registry: ServerFuncRegistry
): TransformResult => {
  const project = createProject()
  const sourceFile = project.createSourceFile(filePath, content, { overwrite: true })

  const fileRegistry = registry.get(filePath)
  const isServerFunctionFile = fileRegistry && fileRegistry.size > 0
  const importedFuncs = getImportedServerFunctions(sourceFile, registry)

  // Don't transform calls to functions defined in the same file
  if (isServerFunctionFile) {
    fileRegistry.forEach((_, name) => importedFuncs.delete(name))
  }

  const callsTransformed = transformCallSites(sourceFile, importedFuncs)
  const handleTransformed = transformHandleCalls(sourceFile)
  const sendTransformed = transformSendCalls(sourceFile)

  if (isServerFunctionFile) {
    return { content: appendRegistryCode(sourceFile, fileRegistry), transformed: true }
  }

  if (callsTransformed || handleTransformed || sendTransformed) {
    return { content: sourceFile.getFullText(), transformed: true }
  }

  return { content, transformed: false }
}

export const emitToJs = (filePath: string, content: string): string => {
  const project = createProject()
  project.createSourceFile(filePath, content, { overwrite: true })
  const files = project.emitToMemory().getFiles()
  return files.length > 0 ? files[0].text : content
}

export const applyReplacements = (code: string, compilationId: string): string => {
  let result = code
  for (const { target, replacement } of getReplacements(compilationId)) {
    result = result.replaceAll(target, replacement)
  }
  return result
}
