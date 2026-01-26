import fs from 'fs'
import path from 'path'
import { Plugin, PluginContext, ResolveIdResult, LoadResult } from 'rollup'
import {
  Options,
  ServerFuncRegistry,
  buildRegistry,
  resolveFilePath,
  transformSourceFile,
  emitToJs,
  applyReplacements,
  generateCompilationId
} from './common'

export function zeroComRollupPlugin(options: Options = {}): Plugin {
  const { development = true } = options
  const compilationId = generateCompilationId()
  const registry: ServerFuncRegistry = new Map()

  return {
    name: 'zero-com-rollup-plugin',

    buildStart() {
      buildRegistry(process.cwd(), registry)
      console.log(`[ZeroComRollupPlugin] Found ${registry.size} files with server functions`)
    },

    async resolveId(this: PluginContext, source: string, importer: string | undefined, opts): Promise<ResolveIdResult> {
      if (!importer || (!source.startsWith('.') && !source.startsWith('/'))) return null

      const result = await this.resolve(source, importer, { ...opts, skipSelf: true })
      if (!result) return null

      let resolvedPath = resolveFilePath(result.id)
      if (!resolvedPath && fs.existsSync(result.id)) resolvedPath = result.id
      if (!resolvedPath) return null

      return { id: resolvedPath, meta: { needsTransform: true } }
    },

    load(this: PluginContext, id: string): LoadResult {
      if (!this.getModuleInfo(id)?.meta?.needsTransform || !fs.existsSync(id)) return null

      const content = fs.readFileSync(id, 'utf8')
      const result = transformSourceFile(id, content, registry, { development })
      if (!result.transformed) return null

      console.log(`[ZeroComRollupPlugin] Transformed: ${path.relative(process.cwd(), id)}`)
      const code = emitToJs(id, result.content)
      return { code, map: result.map ?? null }
    },

    renderChunk(code: string) {
      if (development) return null
      const newCode = applyReplacements(code, compilationId)
      return newCode !== code ? { code: newCode, map: null } : null
    }
  }
}
