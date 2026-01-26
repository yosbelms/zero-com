
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { zeroComRollupPlugin } from '../lib/rollup'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('zeroComRollupPlugin', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-com-test-'))
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
})
