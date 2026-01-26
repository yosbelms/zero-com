import fs from 'fs'
import path from 'path'
import MagicString from 'magic-string'
import type { SourceMap } from 'magic-string'
import { CallExpression, Identifier, Project, PropertyAccessExpression, SourceFile, SyntaxKind, ts } from 'ts-morph'

// Replacement type for collecting transformations
export type Replacement = { start: number; end: number; content: string }

// Types
export type Options = {
  development?: boolean
}

export type ServerFuncInfo = {
  funcId: string
  filePath: string
  exportName: string
}

export type ServerFuncRegistry = Map<string, Map<string, ServerFuncInfo>>

// Constants
export const ZERO_COM_CLIENT_CALL = 'ZERO_COM_CLIENT_CALL'
export const ZERO_COM_SERVER_REGISTRY = 'ZERO_COM_SERVER_REGISTRY'
export const ZERO_COM_CONTEXT_STORAGE = 'ZERO_COM_CONTEXT_STORAGE'
export const SERVER_FUNCTION_WRAPPER_NAME = 'func'
export const HANDLE_NAME = 'handle'
export const CALL_NAME = 'call'
export const LIBRARY_NAME = 'zero-com'
export const FILE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs']

export const formatFuncIdName = (funcName: string, filePath: string, line: number): string => {
  return `${funcName}@${filePath}:${line}`
}

export const generateCompilationId = (): string => String(Math.floor(Math.random() * 1000000))

export const getReplacements = (compilationId: string) => [
  { target: ZERO_COM_CLIENT_CALL, replacement: `__ZERO_COM_CLIENT_CALL_${compilationId}` },
  { target: ZERO_COM_SERVER_REGISTRY, replacement: `__ZERO_COM_SERVER_REGISTRY_${compilationId}` },
  { target: ZERO_COM_CONTEXT_STORAGE, replacement: `__ZERO_COM_CONTEXT_STORAGE_${compilationId}` }
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

    const exportName = decl.getName()
    fileRegistry.set(exportName, {
      funcId: formatFuncIdName(exportName, path.relative(contextDir, filePath), decl.getStartLineNumber()),
      filePath,
      exportName,
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

// Transformations - collect replacements instead of modifying AST
export const collectCallSiteReplacements = (sourceFile: SourceFile, importedFuncs: Map<string, ServerFuncInfo>): Replacement[] => {
  if (importedFuncs.size === 0) return []
  const replacements: Replacement[] = []

  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return
    const callExpr = node as CallExpression
    const calleeName = getCalleeFullName(callExpr)
    const funcInfo = importedFuncs.get(calleeName)
    if (!funcInfo) return

    const args = callExpr.getArguments().map(a => a.getText()).join(', ')
    replacements.push({
      start: callExpr.getStart(),
      end: callExpr.getEnd(),
      content: `globalThis.${ZERO_COM_CLIENT_CALL}('${funcInfo.funcId}', [${args}])`
    })
  })

  return replacements
}

export const collectHandleCallReplacements = (sourceFile: SourceFile): Replacement[] => {
  const replacements: Replacement[] = []

  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return
    const callExpr = node as CallExpression
    if (!isFromLibrary(callExpr, LIBRARY_NAME) || getCalleeName(callExpr) !== HANDLE_NAME) return

    const args = callExpr.getArguments()
    if (args.length < 3) return

    const funcId = args[0].getText()
    const ctx = args[1].getText()
    const argsArray = args[2].getText()
    // Use contextStorage.run() to make context available via context() calls
    replacements.push({
      start: callExpr.getStart(),
      end: callExpr.getEnd(),
      content: `globalThis.${ZERO_COM_CONTEXT_STORAGE}.run(${ctx}, () => globalThis.${ZERO_COM_SERVER_REGISTRY}[${funcId}](...${argsArray}))`
    })
  })

  return replacements
}

export const collectSendCallReplacements = (sourceFile: SourceFile): Replacement[] => {
  const replacements: Replacement[] = []

  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return
    const callExpr = node as CallExpression
    if (!isFromLibrary(callExpr, LIBRARY_NAME) || getCalleeName(callExpr) !== CALL_NAME) return

    const args = callExpr.getArguments()
    if (args.length < 1) return

    replacements.push({
      start: callExpr.getStart(),
      end: callExpr.getEnd(),
      content: `globalThis.${ZERO_COM_CLIENT_CALL} = ${args[0].getText()}`
    })
  })

  return replacements
}

// Collect func(fn) replacements to just fn.
// The func() wrapper is only needed for type-level transformation (RemoveContextParam).
// At runtime, we just need the raw function. The registration code (appendRegistryCode)
// will set requireContext on the function based on compile-time analysis.
export const collectFuncCallReplacements = (sourceFile: SourceFile): Replacement[] => {
  const replacements: Replacement[] = []

  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return
    const callExpr = node as CallExpression
    if (!isFromLibrary(callExpr, LIBRARY_NAME) || getCalleeName(callExpr) !== SERVER_FUNCTION_WRAPPER_NAME) return

    const args = callExpr.getArguments()
    if (args.length !== 1) return

    // Replace func(fn) with just fn
    replacements.push({
      start: callExpr.getStart(),
      end: callExpr.getEnd(),
      content: args[0].getText()
    })
  })

  return replacements
}

// Apply collected replacements using MagicString for sourcemap support
export const applyReplacementsWithMap = (
  source: string,
  replacements: Replacement[],
  filePath: string
): { code: string; map: SourceMap } => {
  const s = new MagicString(source)

  // Sort replacements by start position descending to preserve positions
  const sorted = [...replacements].sort((a, b) => b.start - a.start)

  for (const { start, end, content } of sorted) {
    s.overwrite(start, end, content)
  }

  return {
    code: s.toString(),
    map: s.generateMap({ source: filePath, includeContent: true, hires: true })
  }
}

export const appendRegistryCode = (sourceFile: SourceFile, fileRegistry: Map<string, ServerFuncInfo>): string => {
  // Generate registration code for each server function
  const registrations = Array.from(fileRegistry.values())
    .map(info => `globalThis.${ZERO_COM_SERVER_REGISTRY}['${info.funcId}'] = ${info.exportName};`)
    .join('\n')

  return `${sourceFile.getFullText()}
if (!globalThis.${ZERO_COM_SERVER_REGISTRY}) globalThis.${ZERO_COM_SERVER_REGISTRY} = Object.create(null);
${registrations}`
}

// Main transformation orchestrator
export type TransformResult = { content: string; transformed: boolean; map?: SourceMap }

export type TransformOptions = {
  development?: boolean
}

export const transformSourceFile = (
  filePath: string,
  content: string,
  registry: ServerFuncRegistry,
  options: TransformOptions = {}
): TransformResult => {
  const { development = true } = options
  const project = createProject()
  const sourceFile = project.createSourceFile(filePath, content, { overwrite: true })

  const fileRegistry = registry.get(filePath)
  const isServerFunctionFile = fileRegistry && fileRegistry.size > 0
  const importedFuncs = getImportedServerFunctions(sourceFile, registry)

  // Don't transform calls to functions defined in the same file
  if (isServerFunctionFile) {
    fileRegistry.forEach((_, name) => importedFuncs.delete(name))
  }

  // Collect all replacements
  const replacements: Replacement[] = []

  // Always collect client call site replacements (needed in both dev and prod)
  replacements.push(...collectCallSiteReplacements(sourceFile, importedFuncs))

  // In production mode, collect handle(), call(), and func() replacements.
  // In development mode, these work at runtime via ZERO_COM_DEV_MODE flag.
  if (!development) {
    replacements.push(...collectHandleCallReplacements(sourceFile))
    replacements.push(...collectSendCallReplacements(sourceFile))
  }

  // Handle server function files
  if (isServerFunctionFile) {
    // In production mode, strip func() wrappers
    if (!development) {
      replacements.push(...collectFuncCallReplacements(sourceFile))
    }

    // Apply replacements and append registry code
    if (replacements.length > 0) {
      const { code, map } = applyReplacementsWithMap(content, replacements, filePath)
      // Create a new source file from the transformed code to append registry
      const transformedSourceFile = project.createSourceFile(filePath + '.transformed', code, { overwrite: true })
      return { content: appendRegistryCode(transformedSourceFile, fileRegistry), transformed: true, map }
    }

    return { content: appendRegistryCode(sourceFile, fileRegistry), transformed: true }
  }

  if (replacements.length > 0) {
    const { code, map } = applyReplacementsWithMap(content, replacements, filePath)
    return { content: code, transformed: true, map }
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
