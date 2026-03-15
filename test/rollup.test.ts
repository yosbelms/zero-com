
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

    it('should generate client stubs when ssr is false', () => {
      const apiDir = path.join(tempDir, 'server', 'api')
      fs.mkdirSync(apiDir, { recursive: true })

      const apiFile = path.join(apiDir, 'users.api.ts')
      const code = `import { func, context } from 'zero-com';\n\nexport const getUser = func(async (id: string) => {\n  return { id };\n});\n`
      fs.writeFileSync(apiFile, code)

      process.chdir(tempDir)

      const plugin = zeroComRollupPlugin({ development: true }) as any
      plugin.configResolved()
      plugin.buildStart()

      // ssr: false → client stubs
      const result = plugin.transform(code, apiFile, { ssr: false })

      expect(result).toBeTruthy()
      expect(result.code).toContain('ZERO_COM_CLIENT_CALL')
      expect(result.code).not.toContain('ZERO_COM_SERVER_REGISTRY')
      expect(result.code).not.toContain('import ')
    })

    it('should keep full bodies and registry when ssr is true', () => {
      const apiDir = path.join(tempDir, 'server', 'api')
      fs.mkdirSync(apiDir, { recursive: true })

      const apiFile = path.join(apiDir, 'users.api.ts')
      const code = `import { func, context } from 'zero-com';\n\nexport const getUser = func(async (id: string) => {\n  return { id };\n});\n`
      fs.writeFileSync(apiFile, code)

      process.chdir(tempDir)

      const plugin = zeroComRollupPlugin({ development: true }) as any
      plugin.configResolved()
      plugin.buildStart()

      // ssr: true → server build, full bodies + registry
      const result = plugin.transform(code, apiFile, { ssr: true })

      expect(result).toBeTruthy()
      expect(result.code).toContain('ZERO_COM_SERVER_REGISTRY')
      expect(result.code).toContain('getUser@server/api/users.api.ts:')
    })

    it('should let explicit target option override ssr flag', () => {
      const apiDir = path.join(tempDir, 'server', 'api')
      fs.mkdirSync(apiDir, { recursive: true })

      const apiFile = path.join(apiDir, 'users.api.ts')
      const code = `import { func, context } from 'zero-com';\n\nexport const getUser = func(async (id: string) => {\n  return { id };\n});\n`
      fs.writeFileSync(apiFile, code)

      process.chdir(tempDir)

      // Explicit target: 'client' should override ssr: true
      const plugin = zeroComRollupPlugin({ development: true, target: 'client' }) as any
      plugin.configResolved()
      plugin.buildStart()

      const result = plugin.transform(code, apiFile, { ssr: true })

      expect(result).toBeTruthy()
      expect(result.code).toContain('ZERO_COM_CLIENT_CALL')
      expect(result.code).not.toContain('ZERO_COM_SERVER_REGISTRY')
    })

    it('should be backwards compatible with no target and no ssr flag', () => {
      const apiDir = path.join(tempDir, 'server', 'api')
      fs.mkdirSync(apiDir, { recursive: true })

      const apiFile = path.join(apiDir, 'users.api.ts')
      const code = `import { func, context } from 'zero-com';\n\nexport const getUser = func(async (id: string) => {\n  return { id };\n});\n`
      fs.writeFileSync(apiFile, code)

      process.chdir(tempDir)

      const plugin = zeroComRollupPlugin({ development: true }) as any
      plugin.configResolved()
      plugin.buildStart()

      // No ssr flag → backwards compatible, registry code appended
      const result = plugin.transform(code, apiFile)

      expect(result).toBeTruthy()
      expect(result.code).toContain('ZERO_COM_SERVER_REGISTRY')
    })

    it('should skip node_modules and non-script files', () => {
      const plugin = zeroComRollupPlugin() as any
      plugin.configResolved()

      expect(plugin.transform('code', '/project/node_modules/foo/index.ts')).toBeNull()
      expect(plugin.transform('body {}', '/project/styles.css')).toBeNull()
      expect(plugin.transform('{}', '/project/data.json')).toBeNull()
    })

    describe('mightNeedTransform pre-filter', () => {
      it('should return null without running ts-morph for files unrelated to zero-com', () => {
        const plugin = zeroComRollupPlugin({ development: true }) as any
        plugin.configResolved()
        plugin.buildStart()

        // No zero-com import, no registry entries — pre-filter short-circuits before ts-morph
        const plainCode = 'export const double = (x: number) => x * 2'
        const result = plugin.transform(plainCode, path.join(tempDir, 'util.ts'))
        expect(result).toBeNull()
      })

      it('should process files that import zero-com directly', () => {
        const plugin = zeroComRollupPlugin({ development: false }) as any
        plugin.configResolved()

        const code = `import { handle } from 'zero-com';\nexport const handler = (msg: any) => handle(msg.id, null, msg.args);\n`
        const result = plugin.transform(code, path.join(tempDir, 'handler.ts'))
        // Passes pre-filter (contains 'zero-com'), handle() is transformed in prod mode
        expect(result).toBeTruthy()
        expect(result.code).toContain('ZERO_COM_CONTEXT_STORAGE')
      })

      it('should process client files that import registered server function files', () => {
        const apiDir = path.join(tempDir, 'server')
        fs.mkdirSync(apiDir, { recursive: true })
        fs.writeFileSync(path.join(apiDir, 'api.ts'),
          `import { func } from 'zero-com';\nexport const getUser = func(async (id: string) => ({ id }));\n`)

        process.chdir(tempDir)

        const plugin = zeroComRollupPlugin({ development: true }) as any
        plugin.configResolved()
        plugin.buildStart()

        // Client file doesn't import 'zero-com' but imports a registered server function file
        const clientCode = "import { getUser } from './server/api'\nexport const fetch = () => getUser('1')\n"
        const clientFile = path.join(tempDir, 'client.ts')
        fs.writeFileSync(clientFile, clientCode)

        const result = plugin.transform(clientCode, clientFile)
        expect(result).toBeTruthy()
        expect(result.code).toContain('ZERO_COM_CLIENT_CALL')
      })
    })

    describe('contextDir option', () => {
      it('should scan only the specified contextDir and ignore files outside it', () => {
        const srcDir = path.join(tempDir, 'src')
        const otherDir = path.join(tempDir, 'other')
        fs.mkdirSync(srcDir, { recursive: true })
        fs.mkdirSync(otherDir, { recursive: true })

        const srcApi = path.join(srcDir, 'api.ts')
        const otherApi = path.join(otherDir, 'api.ts')
        const serverFuncCode = `import { func } from 'zero-com';\nexport const getUser = func(async (id: string) => ({ id }));\n`
        fs.writeFileSync(srcApi, serverFuncCode)
        fs.writeFileSync(otherApi, serverFuncCode)

        const plugin = zeroComRollupPlugin({ development: true, contextDir: srcDir }) as any
        plugin.configResolved()
        plugin.buildStart()

        // srcApi should be in registry → transforms with SERVER_REGISTRY
        const srcResult = plugin.transform(serverFuncCode, srcApi)
        expect(srcResult).toBeTruthy()
        expect(srcResult.code).toContain('ZERO_COM_SERVER_REGISTRY')

        // otherApi is outside contextDir → not in registry → not transformed as server function
        const otherResult = plugin.transform(serverFuncCode, otherApi)
        expect(otherResult).toBeNull()
      })

      it('should use process.cwd() as contextDir when option is not provided', () => {
        const originalCwd = process.cwd()
        try {
          const apiDir = path.join(tempDir, 'server')
          fs.mkdirSync(apiDir, { recursive: true })
          const apiFile = path.join(apiDir, 'api.ts')
          fs.writeFileSync(apiFile, `import { func } from 'zero-com';\nexport const getUser = func(async (id: string) => ({ id }));\n`)

          process.chdir(tempDir)

          const plugin = zeroComRollupPlugin({ development: true }) as any
          plugin.configResolved()
          plugin.buildStart()

          const code = fs.readFileSync(apiFile, 'utf8')
          const result = plugin.transform(code, apiFile)
          expect(result).toBeTruthy()
          expect(result.code).toContain('ZERO_COM_SERVER_REGISTRY')
        } finally {
          process.chdir(originalCwd)
        }
      })
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

    describe('transform caching (SSR re-request fix)', () => {
      let originalCwd: string

      beforeEach(() => {
        originalCwd = process.cwd()
      })

      afterEach(() => {
        process.chdir(originalCwd)
      })

      function setupServerFunctionFile() {
        const apiDir = path.join(tempDir, 'server', 'api')
        fs.mkdirSync(apiDir, { recursive: true })
        const apiFile = path.join(apiDir, 'users.api.ts')
        const code = `import { func } from 'zero-com';\n\nexport const getUser = func(async (id: string) => {\n  return { id };\n});\n`
        fs.writeFileSync(apiFile, code)
        return { apiFile, code }
      }

      it('should return the same object reference on second call with identical content', () => {
        const { apiFile, code } = setupServerFunctionFile()
        process.chdir(tempDir)

        const plugin = zeroComRollupPlugin({ development: true }) as any
        plugin.configResolved()
        plugin.buildStart()

        const result1 = plugin.transform(code, apiFile)
        const result2 = plugin.transform(code, apiFile)

        expect(result1).toBeTruthy()
        expect(result2).toBe(result1) // same object — cache hit, ts-morph not re-run
      })

      it('should re-transform when file content changes', () => {
        const { apiFile, code: code1 } = setupServerFunctionFile()
        const code2 = `import { func } from 'zero-com';\n\nexport const getUser = func(async (id: string) => {\n  return { id, updated: true };\n});\n`
        process.chdir(tempDir)

        const plugin = zeroComRollupPlugin({ development: true }) as any
        plugin.configResolved()
        plugin.buildStart()

        const result1 = plugin.transform(code1, apiFile)
        const result2 = plugin.transform(code2, apiFile)

        expect(result1).toBeTruthy()
        expect(result2).toBeTruthy()
        expect(result2).not.toBe(result1) // different objects — cache miss, re-transformed
      })

      it('should clear cache on buildStart so next transform re-runs', () => {
        const { apiFile, code } = setupServerFunctionFile()
        process.chdir(tempDir)

        const plugin = zeroComRollupPlugin({ development: true }) as any
        plugin.configResolved()
        plugin.buildStart()

        const result1 = plugin.transform(code, apiFile)
        expect(result1).toBeTruthy()

        plugin.buildStart() // clears transform cache

        const result2 = plugin.transform(code, apiFile)
        expect(result2).toBeTruthy()
        expect(result2).not.toBe(result1) // new object — cache was cleared
      })

      it('should clear cache on watchChange so next transform re-runs', () => {
        const { apiFile, code } = setupServerFunctionFile()
        process.chdir(tempDir)

        const plugin = zeroComRollupPlugin({ development: true }) as any
        plugin.configResolved()
        plugin.buildStart()

        const result1 = plugin.transform(code, apiFile)
        expect(result1).toBeTruthy()

        plugin.watchChange(apiFile) // clears transform cache

        const result2 = plugin.transform(code, apiFile)
        expect(result2).toBeTruthy()
        expect(result2).not.toBe(result1) // new object — cache was cleared
      })

      it('should cache null result for files that pass pre-filter but need no transform in dev mode', () => {
        setupServerFunctionFile()
        process.chdir(tempDir)

        const plugin = zeroComRollupPlugin({ development: true }) as any
        plugin.configResolved()
        plugin.buildStart()

        // handle() is not transformed in dev mode → result is null
        const handlerCode = `import { handle } from 'zero-com';\nexport const handler = (msg: any) => handle(msg.funcId, null, msg.params);\n`
        const handlerFile = path.join(tempDir, 'handler.ts')
        fs.writeFileSync(handlerFile, handlerCode)

        const result1 = plugin.transform(handlerCode, handlerFile)
        const result2 = plugin.transform(handlerCode, handlerFile)

        expect(result1).toBeNull()
        expect(result2).toBeNull()
      })

      it('should log transform only on first call, not on cached subsequent calls', () => {
        const { apiFile, code } = setupServerFunctionFile()
        process.chdir(tempDir)

        const plugin = zeroComRollupPlugin({ development: true }) as any
        plugin.configResolved()
        plugin.buildStart()

        const logs: string[] = []
        const original = console.log
        console.log = (...args: any[]) => logs.push(args.join(' '))

        try {
          plugin.transform(code, apiFile)
          plugin.transform(code, apiFile)
          plugin.transform(code, apiFile)
        } finally {
          console.log = original
        }

        const transformLogs = logs.filter(l => l.includes('Transformed:'))
        expect(transformLogs).toHaveLength(1) // logged only on first transform
      })
    })
  })
})
