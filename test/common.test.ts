import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import ts from 'typescript'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { formatFuncIdName, isFromLibrary, generateClientStubs, mightNeedTransform, updateRegistryForFile, buildRegistry, hasHandleCall, generateRegistryRequires, transformSourceFile, ZERO_COM_CLIENT_CALL, ZERO_COM_SERVER_REGISTRY, SERVER_FUNCTION_WRAPPER_NAME, ServerFuncInfo, ServerFuncRegistry } from '../lib/common'

function createSourceFile(content: string) {
  const project = new Project({
    compilerOptions: {
      target: ts.ScriptTarget.ES2017,
      module: ts.ModuleKind.ESNext,
    },
  })
  return project.createSourceFile('test.ts', content, { overwrite: true })
}

describe('formatFuncIdName', () => {
  it('should format funcId with name, path, and line', () => {
    expect(formatFuncIdName('getUser', 'api.ts', 5)).toBe('getUser@api.ts:5')
  })

  it('should handle paths with directories', () => {
    expect(formatFuncIdName('getUser', 'lib/api/users.ts', 10)).toBe('getUser@lib/api/users.ts:10')
  })

  it('should handle line number 1', () => {
    expect(formatFuncIdName('fn', 'file.ts', 1)).toBe('fn@file.ts:1')
  })
})

describe('isFromLibrary', () => {
  it('should return true for named import from zero-com', () => {
    const sourceFile = createSourceFile(`
      import { func } from 'zero-com'
      const x = func(() => {})
    `)

    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0]
    expect(isFromLibrary(callExpr, 'zero-com')).toBe(true)
  })

  it('should return false for named import from different library', () => {
    const sourceFile = createSourceFile(`
      import { func } from 'other-lib'
      const x = func(() => {})
    `)

    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0]
    expect(isFromLibrary(callExpr, 'zero-com')).toBe(false)
  })

  it('should return true for aliased import from zero-com', () => {
    const sourceFile = createSourceFile(`
      import { func as serverFunc } from 'zero-com'
      const x = serverFunc(() => {})
    `)

    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0]
    expect(isFromLibrary(callExpr, 'zero-com')).toBe(true)
  })

  it('should return false for local function with same name', () => {
    const sourceFile = createSourceFile(`
      function func(fn: Function) { return fn }
      const x = func(() => {})
    `)

    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0]
    expect(isFromLibrary(callExpr, 'zero-com')).toBe(false)
  })
})

describe('generateClientStubs', () => {
  it('should produce stub exports with funcIds and no imports', () => {
    const fileRegistry = new Map<string, ServerFuncInfo>([
      ['getUser', { funcId: 'getUser@server/api/users.api.ts:4', filePath: '/abs/server/api/users.api.ts', exportName: 'getUser' }],
      ['createUser', { funcId: 'createUser@server/api/users.api.ts:8', filePath: '/abs/server/api/users.api.ts', exportName: 'createUser' }],
    ])

    const result = generateClientStubs(fileRegistry)

    expect(result).toContain(`export const getUser = (...args) => globalThis.${ZERO_COM_CLIENT_CALL}('getUser@server/api/users.api.ts:4', args);`)
    expect(result).toContain(`export const createUser = (...args) => globalThis.${ZERO_COM_CLIENT_CALL}('createUser@server/api/users.api.ts:8', args);`)
    expect(result).not.toContain('import ')
    expect(result).not.toContain(ZERO_COM_SERVER_REGISTRY)
  })

  it('should handle single function', () => {
    const fileRegistry = new Map<string, ServerFuncInfo>([
      ['doSomething', { funcId: 'doSomething@api.ts:1', filePath: '/abs/api.ts', exportName: 'doSomething' }],
    ])

    const result = generateClientStubs(fileRegistry)

    expect(result).toBe(`export const doSomething = (...args) => globalThis.${ZERO_COM_CLIENT_CALL}('doSomething@api.ts:1', args);`)
  })
})

describe('constants', () => {
  it('should export ZERO_COM_CLIENT_CALL', () => {
    expect(ZERO_COM_CLIENT_CALL).toBe('ZERO_COM_CLIENT_CALL')
  })

  it('should export ZERO_COM_SERVER_REGISTRY', () => {
    expect(ZERO_COM_SERVER_REGISTRY).toBe('ZERO_COM_SERVER_REGISTRY')
  })

  it('should export SERVER_FUNCTION_WRAPPER_NAME', () => {
    expect(SERVER_FUNCTION_WRAPPER_NAME).toBe('func')
  })
})

describe('mightNeedTransform', () => {
  it('should return true when content contains the library name', () => {
    const registry: ServerFuncRegistry = new Map()
    expect(mightNeedTransform("import { func } from 'zero-com'", '/file.ts', registry)).toBe(true)
  })

  it('should return true when filePath is already in the registry', () => {
    const registry: ServerFuncRegistry = new Map([['/server/api.ts', new Map()]])
    // Content has no 'zero-com' but file is a registered server function file
    expect(mightNeedTransform('export const foo = () => {}', '/server/api.ts', registry)).toBe(true)
  })

  it('should return true when content imports a file whose basename matches a registry entry', () => {
    const registry: ServerFuncRegistry = new Map([['/project/server/users.api.ts', new Map()]])
    const content = "import { getUser } from './server/users.api'"
    expect(mightNeedTransform(content, '/project/client.ts', registry)).toBe(true)
  })

  it('should return false for files unrelated to zero-com and with no matching imports', () => {
    const registry: ServerFuncRegistry = new Map([['/project/server/users.api.ts', new Map()]])
    const content = "import React from 'react'\nexport const Foo = () => null"
    expect(mightNeedTransform(content, '/project/components/Foo.tsx', registry)).toBe(false)
  })

  it('should return false when registry is empty and content has no library import', () => {
    const registry: ServerFuncRegistry = new Map()
    expect(mightNeedTransform('export const double = (x: number) => x * 2', '/util.ts', registry)).toBe(false)
  })

  it('should return false when import paths do not match any registry entry', () => {
    const registry: ServerFuncRegistry = new Map([['/project/server/users.api.ts', new Map()]])
    // Imports './helpers' — segment 'helpers' doesn't appear in any registry key
    const content = "import { format } from './helpers'"
    expect(mightNeedTransform(content, '/project/client.ts', registry)).toBe(false)
  })
})

describe('updateRegistryForFile', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zero-com-common-test-')))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should add a file to the registry when it contains server functions', () => {
    const filePath = path.join(tempDir, 'api.ts')
    fs.writeFileSync(filePath, `import { func } from 'zero-com';\nexport const getUser = func(async (id: string) => ({ id }));\n`)

    const registry: ServerFuncRegistry = new Map()
    updateRegistryForFile(filePath, tempDir, registry)

    expect(registry.has(filePath)).toBe(true)
    expect(registry.get(filePath)!.has('getUser')).toBe(true)
  })

  it('should remove a file from the registry when it is deleted from disk', () => {
    const filePath = path.join(tempDir, 'api.ts')
    fs.writeFileSync(filePath, `import { func } from 'zero-com';\nexport const getUser = func(async (id: string) => ({ id }));\n`)

    const registry: ServerFuncRegistry = new Map()
    updateRegistryForFile(filePath, tempDir, registry)
    expect(registry.has(filePath)).toBe(true)

    fs.unlinkSync(filePath)
    updateRegistryForFile(filePath, tempDir, registry)
    expect(registry.has(filePath)).toBe(false)
  })

  it('should not add a file that has no server functions', () => {
    const filePath = path.join(tempDir, 'util.ts')
    fs.writeFileSync(filePath, 'export const double = (x: number) => x * 2')

    const registry: ServerFuncRegistry = new Map()
    updateRegistryForFile(filePath, tempDir, registry)

    expect(registry.has(filePath)).toBe(false)
  })

  it('should ignore non-script file extensions', () => {
    const filePath = path.join(tempDir, 'styles.css')
    fs.writeFileSync(filePath, 'body { color: red }')

    const registry: ServerFuncRegistry = new Map()
    updateRegistryForFile(filePath, tempDir, registry)

    expect(registry.size).toBe(0)
  })

  it('should update an existing registry entry when file content changes', () => {
    const filePath = path.join(tempDir, 'api.ts')
    fs.writeFileSync(filePath, `import { func } from 'zero-com';\nexport const getUser = func(async (id: string) => ({ id }));\n`)

    const registry: ServerFuncRegistry = new Map()
    updateRegistryForFile(filePath, tempDir, registry)
    expect(registry.get(filePath)!.size).toBe(1)

    // Add a second server function
    fs.writeFileSync(filePath, `import { func } from 'zero-com';\nexport const getUser = func(async (id: string) => ({ id }));\nexport const createUser = func(async (name: string) => ({ name }));\n`)
    updateRegistryForFile(filePath, tempDir, registry)
    expect(registry.get(filePath)!.size).toBe(2)
    expect(registry.get(filePath)!.has('createUser')).toBe(true)
  })
})

describe('hasHandleCall', () => {
  it('should return true when file imports and calls handle() from zero-com', () => {
    const sourceFile = createSourceFile(`
      import { handle } from 'zero-com'
      export default async function handler(req: any, res: any) {
        const result = await handle(req.body.funcId, {}, req.body.params)
        res.json(result)
      }
    `)
    expect(hasHandleCall(sourceFile)).toBe(true)
  })

  it('should return false when file does not call handle()', () => {
    const sourceFile = createSourceFile(`
      import { func } from 'zero-com'
      export const getUser = func(async (id: string) => ({ id }))
    `)
    expect(hasHandleCall(sourceFile)).toBe(false)
  })

  it('should return false when handle is called from a different library', () => {
    const sourceFile = createSourceFile(`
      import { handle } from 'some-other-lib'
      export default (req: any) => handle(req.id, {}, [])
    `)
    expect(hasHandleCall(sourceFile)).toBe(false)
  })
})

describe('generateRegistryRequires', () => {
  it('should emit a require() line for each registered file', () => {
    const registry: ServerFuncRegistry = new Map([
      ['/project/client/funcs.ts', new Map()],
      ['/project/client/auth.ts', new Map()],
    ])
    const result = generateRegistryRequires(registry)
    expect(result).toContain('require("/project/client/funcs.ts")')
    expect(result).toContain('require("/project/client/auth.ts")')
  })

  it('should return empty string for an empty registry', () => {
    const registry: ServerFuncRegistry = new Map()
    expect(generateRegistryRequires(registry)).toBe('')
  })
})

describe('transformSourceFile — server auto-registration', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zero-com-autoreg-test-')))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should prepend require() calls for all registry files when server processes a handle() file', () => {
    const funcsPath = path.join(tempDir, 'funcs.ts')
    fs.writeFileSync(funcsPath, `import { func } from 'zero-com';\nexport const getUser = func(async (id: string) => ({ id }));\n`)

    const registry: ServerFuncRegistry = new Map()
    buildRegistry(tempDir, registry)

    const handlerSource = `import { handle } from 'zero-com';\nexport default async function handler(req: any, res: any) { const result = await handle(req.body.funcId, {}, req.body.params); res.json(result); }\n`
    const handlerPath = path.join(tempDir, 'handler.ts')

    const result = transformSourceFile(handlerPath, handlerSource, registry, { target: 'server', development: true })

    expect(result.transformed).toBe(true)
    expect(result.content).toContain(`require(${JSON.stringify(funcsPath)})`)
  })

  it('should not inject requires when target is client', () => {
    const funcsPath = path.join(tempDir, 'funcs.ts')
    fs.writeFileSync(funcsPath, `import { func } from 'zero-com';\nexport const getUser = func(async (id: string) => ({ id }));\n`)

    const registry: ServerFuncRegistry = new Map()
    buildRegistry(tempDir, registry)

    const handlerSource = `import { handle } from 'zero-com';\nexport default async function handler(req: any, res: any) { const result = await handle(req.body.funcId, {}, req.body.params); res.json(result); }\n`
    const handlerPath = path.join(tempDir, 'handler.ts')

    const result = transformSourceFile(handlerPath, handlerSource, registry, { target: 'client', development: true })

    expect(result.content).not.toContain('require(')
  })

  it('should not inject requires when file has no handle() call', () => {
    const funcsPath = path.join(tempDir, 'funcs.ts')
    fs.writeFileSync(funcsPath, `import { func } from 'zero-com';\nexport const getUser = func(async (id: string) => ({ id }));\n`)

    const registry: ServerFuncRegistry = new Map()
    buildRegistry(tempDir, registry)

    const otherSource = `import { func } from 'zero-com';\nexport const doSomething = func(async () => 'ok');\n`
    const otherPath = path.join(tempDir, 'other.ts')

    const result = transformSourceFile(otherPath, otherSource, registry, { target: 'server', development: true })

    expect(result.content).not.toContain('require(')
  })

  it('should still inject requires alongside production-mode handle() replacement', () => {
    const funcsPath = path.join(tempDir, 'funcs.ts')
    fs.writeFileSync(funcsPath, `import { func } from 'zero-com';\nexport const getUser = func(async (id: string) => ({ id }));\n`)

    const registry: ServerFuncRegistry = new Map()
    buildRegistry(tempDir, registry)

    const handlerSource = `import { handle } from 'zero-com';\nexport default async function handler(req: any, res: any) { const result = await handle(req.body.funcId, {}, req.body.params); res.json(result); }\n`
    const handlerPath = path.join(tempDir, 'handler.ts')

    const result = transformSourceFile(handlerPath, handlerSource, registry, { target: 'server', development: false })

    expect(result.transformed).toBe(true)
    expect(result.content).toContain(`require(${JSON.stringify(funcsPath)})`)
    // Production mode also replaces handle() call
    expect(result.content).toContain(ZERO_COM_SERVER_REGISTRY)
  })
})

describe('buildRegistry pre-filter', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zero-com-registry-test-')))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should only include files that contain server functions', () => {
    fs.writeFileSync(path.join(tempDir, 'api.ts'),
      `import { func } from 'zero-com';\nexport const getUser = func(async (id: string) => ({ id }));\n`)
    fs.writeFileSync(path.join(tempDir, 'util.ts'),
      'export const double = (x: number) => x * 2')
    fs.writeFileSync(path.join(tempDir, 'constants.ts'),
      "export const BASE_URL = 'http://localhost'")

    const registry: ServerFuncRegistry = new Map()
    buildRegistry(tempDir, registry)

    // Only api.ts has server functions
    expect(registry.size).toBe(1)
    const apiPath = path.join(tempDir, 'api.ts')
    expect(registry.has(apiPath)).toBe(true)
  })

  it('should skip files that import from zero-com but declare no server functions', () => {
    // A handler file that uses handle() but isn't a server function file
    fs.writeFileSync(path.join(tempDir, 'handler.ts'),
      `import { handle } from 'zero-com';\nexport const handler = (msg: any) => handle(msg.id, null, msg.args);\n`)

    const registry: ServerFuncRegistry = new Map()
    buildRegistry(tempDir, registry)

    // handler.ts has no func() exports — should not be in registry
    expect(registry.size).toBe(0)
  })

  it('should not traverse node_modules or hidden directories', () => {
    const nodeModulesDir = path.join(tempDir, 'node_modules', 'some-pkg')
    const hiddenDir = path.join(tempDir, '.cache')
    fs.mkdirSync(nodeModulesDir, { recursive: true })
    fs.mkdirSync(hiddenDir, { recursive: true })

    fs.writeFileSync(path.join(nodeModulesDir, 'api.ts'),
      `import { func } from 'zero-com';\nexport const getUser = func(async (id: string) => ({ id }));\n`)
    fs.writeFileSync(path.join(hiddenDir, 'api.ts'),
      `import { func } from 'zero-com';\nexport const getUser = func(async (id: string) => ({ id }));\n`)

    const registry: ServerFuncRegistry = new Map()
    buildRegistry(tempDir, registry)

    expect(registry.size).toBe(0)
  })
})
