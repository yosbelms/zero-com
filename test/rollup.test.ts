
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { zeroComRollupPlugin } from '../lib/rollup'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('zeroComRollupPlugin', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zero-com-test-')))
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

  describe('production mode (development: false)', () => {
    it('should transform handle() to use contextStorage.run()', async () => {
      const plugin = zeroComRollupPlugin({ development: false })
      const { load } = plugin as any

      const filePath = path.join(tempDir, 'test-file.ts')
      const code = `
        import { handle } from 'zero-com';
        export const handler = async (msg) => {
          return await handle(msg.funcId, null, msg.params);
        }
      `
      fs.writeFileSync(filePath, code)

      // Mock context
      const context = {
        getModuleInfo: () => ({ meta: { needsTransform: true } })
      }

      const result = await load.call(context, filePath)

      expect(result).toBeTruthy()
      // Result is now { code, map } object
      const output = typeof result === 'string' ? result : result.code
      // Check that handle() was transformed to use contextStorage.run()
      expect(output).toContain('ZERO_COM_CONTEXT_STORAGE')
      expect(output).toContain('ZERO_COM_SERVER_REGISTRY')
    })
  })

  describe('development mode (development: true)', () => {
    it('should NOT transform handle() - runtime implementation used', async () => {
      const plugin = zeroComRollupPlugin({ development: true })
      const { load } = plugin as any

      const filePath = path.join(tempDir, 'test-file-dev.ts')
      const code = `
        import { handle } from 'zero-com';
        export const handler = async (msg) => {
          return await handle(msg.funcId, null, msg.params);
        }
      `
      fs.writeFileSync(filePath, code)

      // Mock context
      const context = {
        getModuleInfo: () => ({ meta: { needsTransform: true } })
      }

      const result = await load.call(context, filePath)

      // In development mode, handle() should NOT be transformed
      // The original handle() call should remain
      expect(result).toBeNull() // No transformation needed
    })
  })

  describe('Vite mode (configResolved + transform)', () => {
    let originalCwd: string

    beforeEach(() => {
      originalCwd = process.cwd()
    })

    afterEach(() => {
      process.chdir(originalCwd)
    })

    it('should expose configResolved hook', () => {
      const plugin = zeroComRollupPlugin() as any
      expect(typeof plugin.configResolved).toBe('function')
    })

    it('should skip resolveId and load after configResolved', async () => {
      const plugin = zeroComRollupPlugin({ development: false }) as any
      plugin.configResolved()

      const filePath = path.join(tempDir, 'test.ts')
      fs.writeFileSync(filePath, `import { handle } from 'zero-com'; handle('f', null, []);`)

      const resolveResult = await plugin.resolveId.call(
        { resolve: async () => ({ id: filePath }) },
        './test', '/importer.ts', {}
      )
      expect(resolveResult).toBeNull()

      const loadResult = plugin.load.call(
        { getModuleInfo: () => ({ meta: { needsTransform: true } }) },
        filePath
      )
      expect(loadResult).toBeNull()
    })

    it('should transform handle() in production mode via transform', () => {
      const plugin = zeroComRollupPlugin({ development: false }) as any
      plugin.configResolved()

      const code = `
        import { handle } from 'zero-com';
        export const handler = async (msg) => {
          return await handle(msg.funcId, null, msg.params);
        }
      `
      const result = plugin.transform(code, path.join(tempDir, 'handler.ts'))

      expect(result).toBeTruthy()
      expect(result.code).toContain('ZERO_COM_CONTEXT_STORAGE')
      expect(result.code).toContain('ZERO_COM_SERVER_REGISTRY')
    })

    it('should NOT transform handle() in development mode via transform', () => {
      const plugin = zeroComRollupPlugin({ development: true }) as any
      plugin.configResolved()

      const code = `
        import { handle } from 'zero-com';
        export const handler = async (msg) => {
          return await handle(msg.funcId, null, msg.params);
        }
      `
      const result = plugin.transform(code, path.join(tempDir, 'handler.ts'))
      expect(result).toBeNull()
    })

    it('should transform server function files and append registry code', () => {
      const apiDir = path.join(tempDir, 'server', 'api')
      fs.mkdirSync(apiDir, { recursive: true })

      const apiFile = path.join(apiDir, 'users.api.ts')
      const code = `import { func, context } from 'zero-com';\n\nexport const getUser = func(async (id: string) => {\n  return { id };\n});\n`
      fs.writeFileSync(apiFile, code)

      process.chdir(tempDir)

      const plugin = zeroComRollupPlugin({ development: true }) as any
      plugin.configResolved()
      plugin.buildStart()

      const result = plugin.transform(code, apiFile)

      expect(result).toBeTruthy()
      expect(result.code).toContain('ZERO_COM_SERVER_REGISTRY')
      expect(result.code).toContain('getUser@server/api/users.api.ts:')
    })

    it('should transform client call sites importing server functions', () => {
      const apiDir = path.join(tempDir, 'server', 'api')
      const clientDir = path.join(tempDir, 'client')
      fs.mkdirSync(apiDir, { recursive: true })
      fs.mkdirSync(clientDir, { recursive: true })

      fs.writeFileSync(path.join(apiDir, 'users.api.ts'),
        `import { func } from 'zero-com';\n\nexport const getUser = func(async (id: string) => {\n  return { id };\n});\n`
      )

      const clientCode = `import { getUser } from '../server/api/users.api';\n\nconst user = await getUser('123');\n`
      const clientFile = path.join(clientDir, 'page.ts')
      fs.writeFileSync(clientFile, clientCode)

      process.chdir(tempDir)

      const plugin = zeroComRollupPlugin({ development: true }) as any
      plugin.configResolved()
      plugin.buildStart()

      const result = plugin.transform(clientCode, clientFile)

      expect(result).toBeTruthy()
      expect(result.code).toContain('ZERO_COM_CLIENT_CALL')
    })

    it('should skip node_modules and non-script files', () => {
      const plugin = zeroComRollupPlugin() as any
      plugin.configResolved()

      expect(plugin.transform('code', '/project/node_modules/foo/index.ts')).toBeNull()
      expect(plugin.transform('body {}', '/project/styles.css')).toBeNull()
      expect(plugin.transform('{}', '/project/data.json')).toBeNull()
    })

    it('should not use transform when not in Vite mode', () => {
      const plugin = zeroComRollupPlugin({ development: false }) as any
      // Do NOT call configResolved — Rollup mode

      const code = `
        import { handle } from 'zero-com';
        export const handler = async (msg) => {
          return await handle(msg.funcId, null, msg.params);
        }
      `
      const result = plugin.transform(code, path.join(tempDir, 'handler.ts'))
      expect(result).toBeNull()
    })
  })
})
