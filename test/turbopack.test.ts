import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import turbopackLoader from '../lib/turbopack-loader'
import { ZERO_COM_CLIENT_CALL, ZERO_COM_SERVER_REGISTRY } from '../lib/common'

// Create a mock LoaderContext
function createLoaderContext(opts: {
  resourcePath: string
  rootContext: string
  options?: Record<string, unknown>
}) {
  let result: { err: Error | null; content?: string; map?: unknown } | null = null
  const ctx = {
    resourcePath: opts.resourcePath,
    rootContext: opts.rootContext,
    getOptions() {
      return opts.options || {}
    },
    callback(err: Error | null, content?: string, map?: unknown) {
      result = { err, content, map }
    },
    getResult() {
      return result
    },
  }
  return ctx
}

describe('turbopackLoader', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-com-turbopack-test-'))
  })

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    } catch (e) {
      // ignore
    }
  })

  function writeFixture(name: string, content: string): string {
    const filePath = path.join(tempDir, name)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    return filePath
  }

  it('should transform client call sites to globalThis calls', () => {
    const apiPath = writeFixture('api.ts', `
import { func } from 'zero-com'
export const getUser = func((id: string) => {
  return { id, name: 'Test' }
})
`)
    const clientPath = writeFixture('client.ts', `
import { getUser } from './api'
export async function fetchUser(userId: string) {
  return await getUser(userId)
}
`)
    const source = fs.readFileSync(clientPath, 'utf8')
    const ctx = createLoaderContext({
      resourcePath: clientPath,
      rootContext: tempDir,
      options: { development: true },
    })

    turbopackLoader.call(ctx as any, source)
    const result = ctx.getResult()!

    expect(result.err).toBeNull()
    expect(result.content).toContain(`globalThis.${ZERO_COM_CLIENT_CALL}`)
    expect(result.content).toContain('[userId]')
  })

  it('should append registry code for server function files', () => {
    const apiPath = writeFixture('api.ts', `
import { func } from 'zero-com'
export const getUser = func((id: string) => {
  return { id, name: 'Test' }
})
export const createUser = func((name: string) => {
  return { name }
})
`)
    const source = fs.readFileSync(apiPath, 'utf8')
    const ctx = createLoaderContext({
      resourcePath: apiPath,
      rootContext: tempDir,
      options: { development: true },
    })

    turbopackLoader.call(ctx as any, source)
    const result = ctx.getResult()!

    expect(result.err).toBeNull()
    expect(result.content).toContain(`globalThis.${ZERO_COM_SERVER_REGISTRY}`)
    expect(result.content).toMatch(/globalThis\.ZERO_COM_SERVER_REGISTRY\['getUser@api\.ts:\d+'\] = getUser/)
    expect(result.content).toMatch(/globalThis\.ZERO_COM_SERVER_REGISTRY\['createUser@api\.ts:\d+'\] = createUser/)
  })

  it('should not transform files with no server function usage', () => {
    writeFixture('api.ts', `
import { func } from 'zero-com'
export const getUser = func((id: string) => {
  return { id }
})
`)
    const utilPath = writeFixture('util.ts', `
export function double(x: number) {
  return x * 2
}
`)
    const source = fs.readFileSync(utilPath, 'utf8')
    const ctx = createLoaderContext({
      resourcePath: utilPath,
      rootContext: tempDir,
      options: { development: true },
    })

    turbopackLoader.call(ctx as any, source)
    const result = ctx.getResult()!

    expect(result.err).toBeNull()
    // Should return original source untransformed
    expect(result.content).toBe(source)
  })

  it('should cache registry across invocations', () => {
    const apiPath = writeFixture('api.ts', `
import { func } from 'zero-com'
export const getUser = func((id: string) => {
  return { id }
})
`)
    const clientPath = writeFixture('client.ts', `
import { getUser } from './api'
export const fetch1 = () => getUser('1')
`)
    const client2Path = writeFixture('client2.ts', `
import { getUser } from './api'
export const fetch2 = () => getUser('2')
`)

    // First invocation
    const ctx1 = createLoaderContext({
      resourcePath: clientPath,
      rootContext: tempDir,
      options: { development: true },
    })
    turbopackLoader.call(ctx1 as any, fs.readFileSync(clientPath, 'utf8'))

    // Second invocation (should reuse cached registry)
    const ctx2 = createLoaderContext({
      resourcePath: client2Path,
      rootContext: tempDir,
      options: { development: true },
    })
    turbopackLoader.call(ctx2 as any, fs.readFileSync(client2Path, 'utf8'))

    const result1 = ctx1.getResult()!
    const result2 = ctx2.getResult()!

    expect(result1.content).toContain(`globalThis.${ZERO_COM_CLIENT_CALL}`)
    expect(result2.content).toContain(`globalThis.${ZERO_COM_CLIENT_CALL}`)
  })

  it('should use rootDir from options when provided', () => {
    const subDir = path.join(tempDir, 'src')
    fs.mkdirSync(subDir, { recursive: true })

    const apiPath = writeFixture('src/api.ts', `
import { func } from 'zero-com'
export const getUser = func((id: string) => {
  return { id }
})
`)
    const clientPath = writeFixture('src/client.ts', `
import { getUser } from './api'
export const fetchUser = () => getUser('1')
`)

    const ctx = createLoaderContext({
      resourcePath: clientPath,
      rootContext: tempDir,
      options: { development: true, rootDir: subDir },
    })
    turbopackLoader.call(ctx as any, fs.readFileSync(clientPath, 'utf8'))

    const result = ctx.getResult()!
    expect(result.err).toBeNull()
    expect(result.content).toContain(`globalThis.${ZERO_COM_CLIENT_CALL}`)
  })

  it('should default development to true', () => {
    const apiPath = writeFixture('api.ts', `
import { func } from 'zero-com'
export const getUser = func((id: string) => {
  return { id }
})
`)
    const source = fs.readFileSync(apiPath, 'utf8')

    // No development option provided — should default to true (dev mode keeps func() wrappers)
    const ctx = createLoaderContext({
      resourcePath: apiPath,
      rootContext: tempDir,
      options: {},
    })
    turbopackLoader.call(ctx as any, source)

    const result = ctx.getResult()!
    expect(result.err).toBeNull()
    // In dev mode, func() calls are NOT stripped — original func() should remain
    expect(result.content).toContain('func(')
  })

  it('should strip func() wrappers in production mode', () => {
    const apiPath = writeFixture('api.ts', `
import { func } from 'zero-com'
export const getUser = func((id: string) => {
  return { id }
})
`)
    const source = fs.readFileSync(apiPath, 'utf8')

    const ctx = createLoaderContext({
      resourcePath: apiPath,
      rootContext: tempDir,
      options: { development: false },
    })
    turbopackLoader.call(ctx as any, source)

    const result = ctx.getResult()!
    expect(result.err).toBeNull()
    // In production mode, func() wrappers should be replaced with the inner function
    expect(result.content).not.toMatch(/\bfunc\(/)
    expect(result.content).toContain(`globalThis.${ZERO_COM_SERVER_REGISTRY}`)
  })

  it('should produce a source map when transforming', () => {
    const apiPath = writeFixture('api.ts', `
import { func } from 'zero-com'
export const getUser = func((id: string) => {
  return { id }
})
`)
    const clientPath = writeFixture('client.ts', `
import { getUser } from './api'
export const fetchUser = () => getUser('1')
`)
    const source = fs.readFileSync(clientPath, 'utf8')
    const ctx = createLoaderContext({
      resourcePath: clientPath,
      rootContext: tempDir,
      options: { development: true },
    })

    turbopackLoader.call(ctx as any, source)
    const result = ctx.getResult()!

    expect(result.err).toBeNull()
    expect(result.map).toBeTruthy()
  })
})
