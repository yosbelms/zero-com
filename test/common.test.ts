import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import ts from 'typescript'
import { formatFuncIdName, isFromLibrary, generateClientStubs, ZERO_COM_CLIENT_CALL, ZERO_COM_SERVER_REGISTRY, SERVER_FUNCTION_WRAPPER_NAME, ServerFuncInfo } from '../lib/common'

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
