import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { ArrowFunction, Project, SyntaxKind, CallExpression, Identifier, PropertyAccessExpression, SourceFile } from 'ts-morph'
import ts from 'typescript'
import { ServerFuncInfo, ServerFuncRegistry, ZERO_COM_CLIENT_CALL, ZERO_COM_SERVER_REGISTRY, formatFuncIdName, isFromLibrary, SERVER_FUNCTION_WRAPPER_NAME, CONTEXT_TYPE_NAME } from '../lib/common'

const fixturesDir = path.join(__dirname, '__fixtures__')

// Helper to create a ts-morph project with fixture content
function createProject(content: string, filePath: string): SourceFile {
  const project = new Project({
    compilerOptions: {
      target: ts.ScriptTarget.ES2017,
      module: ts.ModuleKind.ESNext,
    },
  })
  return project.createSourceFile(filePath, content, { overwrite: true })
}

// Extracted logic from webpack plugin for testing
function scanFileForServerFunctions(filePath: string, contextDir: string): Map<string, ServerFuncInfo> {
  const content = fs.readFileSync(filePath, 'utf8')
  const sourceFile = createProject(content, filePath)
  const fileRegistry = new Map<string, ServerFuncInfo>()

  sourceFile.getVariableDeclarations().forEach(decl => {
    if (!decl.isExported()) return

    const initializer = decl.getInitializer()
    if (!initializer) return

    if (initializer.getKind() !== SyntaxKind.CallExpression) return

    const callExpr = initializer as CallExpression

    if (!isFromLibrary(callExpr, 'zero-com')) return

    const funcExprText = callExpr.getExpression().getText()
    if (funcExprText !== SERVER_FUNCTION_WRAPPER_NAME && !funcExprText.endsWith(`.${SERVER_FUNCTION_WRAPPER_NAME}`)) {
      return
    }

    const args = callExpr.getArguments()

    // func() should have exactly one argument: the arrow function
    if (args.length !== 1 || args[0].getKind() !== SyntaxKind.ArrowFunction) {
      return // Not a valid func() call
    }

    const arrowFunc = args[0] as ArrowFunction
    const params = arrowFunc.getParameters()
    let requireContext = false

    // Check if first parameter has Context type annotation
    if (params.length > 0) {
      const firstParam = params[0]
      const typeNode = firstParam.getTypeNode()
      if (typeNode) {
        const typeText = typeNode.getText()
        // Check if first param type starts with Context (e.g., Context, Context<{userId: string}>)
        requireContext = typeText.startsWith(CONTEXT_TYPE_NAME)
      }
    }

    const exportName = decl.getName()
    const lineNumber = decl.getStartLineNumber()
    const relativePath = path.relative(contextDir, filePath)
    const funcId = formatFuncIdName(exportName, relativePath, lineNumber)

    fileRegistry.set(exportName, {
      funcId,
      filePath,
      exportName,
      requireContext,
    })
  })

  return fileRegistry
}

function getImportedServerFunctions(sourceFile: SourceFile, serverFuncRegistry: ServerFuncRegistry): Map<string, ServerFuncInfo> {
  const importedFuncs = new Map<string, ServerFuncInfo>()

  sourceFile.getImportDeclarations().forEach(importDecl => {
    const moduleSpecifier = importDecl.getModuleSpecifierValue()
    const sourceFilePath = sourceFile.getFilePath()
    const sourceDir = path.dirname(sourceFilePath)

    let resolvedPath = ''
    if (moduleSpecifier.startsWith('.')) {
      const basePath = path.resolve(sourceDir, moduleSpecifier)

      for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs']) {
        const tryPath = basePath + ext
        if (fs.existsSync(tryPath)) {
          resolvedPath = tryPath
          break
        }
      }
    }

    if (!resolvedPath) return

    const fileRegistry = serverFuncRegistry.get(resolvedPath)
    if (!fileRegistry) return

    importDecl.getNamedImports().forEach(namedImport => {
      const importedName = namedImport.getName()
      const localName = namedImport.getAliasNode()?.getText() || importedName

      const funcInfo = fileRegistry.get(importedName)
      if (funcInfo) {
        importedFuncs.set(localName, funcInfo)
      }
    })

    const namespaceImport = importDecl.getNamespaceImport()
    if (namespaceImport) {
      const namespaceName = namespaceImport.getText()
      fileRegistry.forEach((funcInfo, exportName) => {
        importedFuncs.set(`${namespaceName}.${exportName}`, funcInfo)
      })
    }
  })

  return importedFuncs
}

function transformCallSites(sourceFile: SourceFile, importedFuncs: Map<string, ServerFuncInfo>): boolean {
  if (importedFuncs.size === 0) return false

  let modified = false

  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return

    const callExpr = node as CallExpression
    const expression = callExpr.getExpression()

    let calleeName = ''

    if (expression.getKind() === SyntaxKind.Identifier) {
      calleeName = (expression as Identifier).getText()
    } else if (expression.getKind() === SyntaxKind.PropertyAccessExpression) {
      calleeName = (expression as PropertyAccessExpression).getText()
    }

    if (!calleeName) return

    const funcInfo = importedFuncs.get(calleeName)
    if (!funcInfo) return

    const args = callExpr.getArguments().map(arg => arg.getText()).join(', ')
    const newCall = `globalThis.${ZERO_COM_CLIENT_CALL}('${funcInfo.funcId}', [${args}])`

    callExpr.replaceWithText(newCall)
    modified = true
  })

  return modified
}

function appendRegistryCode(sourceFile: SourceFile, fileRegistry: Map<string, ServerFuncInfo>): string {
  const registrations: string[] = []

  fileRegistry.forEach((funcInfo) => {
    registrations.push(
      `globalThis.${ZERO_COM_SERVER_REGISTRY}['${funcInfo.funcId}'] = ${funcInfo.exportName}`
    )
  })

  const registryInit = `if (!globalThis.${ZERO_COM_SERVER_REGISTRY}) globalThis.${ZERO_COM_SERVER_REGISTRY} = Object.create(null);`

  return `${sourceFile.getFullText()}\n${registryInit}\n${registrations.join(';\n')};`
}

describe('ZeroComWebpackPlugin', () => {
  describe('scanFileForServerFunctions', () => {
    it('should find exported func() declarations', () => {
      const apiPath = path.join(fixturesDir, 'api.ts')
      const registry = scanFileForServerFunctions(apiPath, fixturesDir)

      expect(registry.size).toBe(3)
      expect(registry.has('getUser')).toBe(true)
      expect(registry.has('createUser')).toBe(true)
      expect(registry.has('getUserWithContext')).toBe(true)
    })

    it('should not include non-func exports', () => {
      const apiPath = path.join(fixturesDir, 'api.ts')
      const registry = scanFileForServerFunctions(apiPath, fixturesDir)

      expect(registry.has('helperFunction')).toBe(false)
    })

    it('should detect requireContext flag from Context type annotation', () => {
      const apiPath = path.join(fixturesDir, 'api.ts')
      const registry = scanFileForServerFunctions(apiPath, fixturesDir)

      expect(registry.get('getUser')?.requireContext).toBe(false)
      expect(registry.get('createUser')?.requireContext).toBe(false)
      expect(registry.get('getUserWithContext')?.requireContext).toBe(true)
    })

    it('should generate correct funcId format', () => {
      const apiPath = path.join(fixturesDir, 'api.ts')
      const registry = scanFileForServerFunctions(apiPath, fixturesDir)

      const getUserInfo = registry.get('getUser')!
      expect(getUserInfo.funcId).toMatch(/^getUser@api\.ts:\d+$/)
    })
  })

  describe('getImportedServerFunctions', () => {
    let serverFuncRegistry: ServerFuncRegistry

    beforeEach(() => {
      const apiPath = path.join(fixturesDir, 'api.ts')
      const fileRegistry = scanFileForServerFunctions(apiPath, fixturesDir)
      serverFuncRegistry = new Map()
      serverFuncRegistry.set(apiPath, fileRegistry)
    })

    it('should map named imports to server functions', () => {
      const clientPath = path.join(fixturesDir, 'client.ts')
      const content = fs.readFileSync(clientPath, 'utf8')
      const sourceFile = createProject(content, clientPath)

      const importedFuncs = getImportedServerFunctions(sourceFile, serverFuncRegistry)

      expect(importedFuncs.has('getUser')).toBe(true)
      expect(importedFuncs.has('createUser')).toBe(true)
      expect(importedFuncs.has('getUserWithContext')).toBe(true)
    })

    it('should not include non-server-function imports', () => {
      const clientPath = path.join(fixturesDir, 'client.ts')
      const content = fs.readFileSync(clientPath, 'utf8')
      const sourceFile = createProject(content, clientPath)

      const importedFuncs = getImportedServerFunctions(sourceFile, serverFuncRegistry)

      expect(importedFuncs.has('helperFunction')).toBe(false)
    })

    it('should handle aliased imports', () => {
      const clientPath = path.join(fixturesDir, 'client-aliased.ts')
      const content = fs.readFileSync(clientPath, 'utf8')
      const sourceFile = createProject(content, clientPath)

      const importedFuncs = getImportedServerFunctions(sourceFile, serverFuncRegistry)

      expect(importedFuncs.has('fetchUser')).toBe(true)
      expect(importedFuncs.has('registerNewUser')).toBe(true)
      expect(importedFuncs.has('getUser')).toBe(false) // Original name not used
    })

    it('should handle namespace imports', () => {
      const clientPath = path.join(fixturesDir, 'client-namespace.ts')
      const content = fs.readFileSync(clientPath, 'utf8')
      const sourceFile = createProject(content, clientPath)

      const importedFuncs = getImportedServerFunctions(sourceFile, serverFuncRegistry)

      expect(importedFuncs.has('api.getUser')).toBe(true)
      expect(importedFuncs.has('api.createUser')).toBe(true)
      expect(importedFuncs.has('api.getUserWithContext')).toBe(true)
    })
  })

  describe('transformCallSites', () => {
    let serverFuncRegistry: ServerFuncRegistry

    beforeEach(() => {
      const apiPath = path.join(fixturesDir, 'api.ts')
      const fileRegistry = scanFileForServerFunctions(apiPath, fixturesDir)
      serverFuncRegistry = new Map()
      serverFuncRegistry.set(apiPath, fileRegistry)
    })

    it('should transform direct function calls', () => {
      const clientPath = path.join(fixturesDir, 'client.ts')
      const content = fs.readFileSync(clientPath, 'utf8')
      const sourceFile = createProject(content, clientPath)

      const importedFuncs = getImportedServerFunctions(sourceFile, serverFuncRegistry)
      const modified = transformCallSites(sourceFile, importedFuncs)

      expect(modified).toBe(true)

      const result = sourceFile.getFullText()
      expect(result).toContain(`globalThis.${ZERO_COM_CLIENT_CALL}('getUser@api.ts:`)
      expect(result).toContain(`globalThis.${ZERO_COM_CLIENT_CALL}('createUser@api.ts:`)
    })

    it('should transform calls with correct arguments', () => {
      const clientPath = path.join(fixturesDir, 'client.ts')
      const content = fs.readFileSync(clientPath, 'utf8')
      const sourceFile = createProject(content, clientPath)

      const importedFuncs = getImportedServerFunctions(sourceFile, serverFuncRegistry)
      transformCallSites(sourceFile, importedFuncs)

      const result = sourceFile.getFullText()
      expect(result).toMatch(/globalThis\.ZERO_COM_CLIENT_CALL\('getUser@api\.ts:\d+', \[userId\]\)/)
      expect(result).toMatch(/globalThis\.ZERO_COM_CLIENT_CALL\('createUser@api\.ts:\d+', \[name, email\]\)/)
    })

    it('should not transform non-server-function calls', () => {
      const clientPath = path.join(fixturesDir, 'client.ts')
      const content = fs.readFileSync(clientPath, 'utf8')
      const sourceFile = createProject(content, clientPath)

      const importedFuncs = getImportedServerFunctions(sourceFile, serverFuncRegistry)
      transformCallSites(sourceFile, importedFuncs)

      const result = sourceFile.getFullText()
      expect(result).toContain('helperFunction(x)')
    })

    it('should transform aliased function calls', () => {
      const clientPath = path.join(fixturesDir, 'client-aliased.ts')
      const content = fs.readFileSync(clientPath, 'utf8')
      const sourceFile = createProject(content, clientPath)

      const importedFuncs = getImportedServerFunctions(sourceFile, serverFuncRegistry)
      transformCallSites(sourceFile, importedFuncs)

      const result = sourceFile.getFullText()
      expect(result).toMatch(/globalThis\.ZERO_COM_CLIENT_CALL\('getUser@api\.ts:\d+', \[userId\]\)/)
      expect(result).toMatch(/globalThis\.ZERO_COM_CLIENT_CALL\('createUser@api\.ts:\d+', \[name, email\]\)/)
    })

    it('should transform namespace function calls', () => {
      const clientPath = path.join(fixturesDir, 'client-namespace.ts')
      const content = fs.readFileSync(clientPath, 'utf8')
      const sourceFile = createProject(content, clientPath)

      const importedFuncs = getImportedServerFunctions(sourceFile, serverFuncRegistry)
      transformCallSites(sourceFile, importedFuncs)

      const result = sourceFile.getFullText()
      expect(result).toMatch(/globalThis\.ZERO_COM_CLIENT_CALL\('getUser@api\.ts:\d+', \[userId\]\)/)
      expect(result).toMatch(/globalThis\.ZERO_COM_CLIENT_CALL\('createUser@api\.ts:\d+', \[name, email\]\)/)
    })
  })

  describe('appendRegistryCode', () => {
    it('should append registry initialization and registrations', () => {
      const apiPath = path.join(fixturesDir, 'api.ts')
      const content = fs.readFileSync(apiPath, 'utf8')
      const sourceFile = createProject(content, apiPath)
      const fileRegistry = scanFileForServerFunctions(apiPath, fixturesDir)

      const result = appendRegistryCode(sourceFile, fileRegistry)

      expect(result).toContain(`if (!globalThis.${ZERO_COM_SERVER_REGISTRY}) globalThis.${ZERO_COM_SERVER_REGISTRY} = Object.create(null);`)
      expect(result).toMatch(/globalThis\.ZERO_COM_SERVER_REGISTRY\['getUser@api\.ts:\d+'\] = getUser/)
      expect(result).toMatch(/globalThis\.ZERO_COM_SERVER_REGISTRY\['createUser@api\.ts:\d+'\] = createUser/)
      expect(result).toMatch(/globalThis\.ZERO_COM_SERVER_REGISTRY\['getUserWithContext@api\.ts:\d+'\] = getUserWithContext/)
    })

    it('should preserve original source code', () => {
      const apiPath = path.join(fixturesDir, 'api.ts')
      const content = fs.readFileSync(apiPath, 'utf8')
      const sourceFile = createProject(content, apiPath)
      const fileRegistry = scanFileForServerFunctions(apiPath, fixturesDir)

      const result = appendRegistryCode(sourceFile, fileRegistry)

      expect(result).toContain("import { func, context } from 'zero-com'")
      expect(result).toContain('export const getUser = func((id: string)')
    })
  })

  describe('formatFuncIdName', () => {
    it('should format funcId correctly', () => {
      expect(formatFuncIdName('getUser', 'api.ts', 5)).toBe('getUser@api.ts:5')
      expect(formatFuncIdName('createUser', 'lib/api.ts', 10)).toBe('createUser@lib/api.ts:10')
    })
  })
})
