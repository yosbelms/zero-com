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

export function zeroComRollupPlugin(options: Options = {}): Plugin & { configResolved?: () => void } {
  const { development = true, target } = options
  const compilationId = generateCompilationId()
  const registry: ServerFuncRegistry = new Map()
  let isVite = false

  return {
    name: 'zero-com-rollup-plugin',

    // Vite-only hook — detect that we're running inside Vite
    configResolved() {
      isVite = true
    },

    buildStart() {
      buildRegistry(process.cwd(), registry)
      for (const fileRegistry of registry.values()) {
        for (const info of fileRegistry.values()) {
          console.log(`[ZeroComRollupPlugin] ${info.funcId}`)
        }
      }
    },

    // Rollup path: resolveId marks files, load transforms them.
    // Skipped in Vite because meta doesn't propagate from resolveId to load.
    async resolveId(this: PluginContext, source: string, importer: string | undefined, opts): Promise<ResolveIdResult> {
      if (isVite) return null
      if (!importer || (!source.startsWith('.') && !source.startsWith('/'))) return null

      const result = await this.resolve(source, importer, { ...opts, skipSelf: true })
      if (!result) return null

      let resolvedPath = resolveFilePath(result.id)
      if (!resolvedPath && fs.existsSync(result.id)) resolvedPath = result.id
      if (!resolvedPath) return null

      return { id: resolvedPath, meta: { needsTransform: true } }
    },

    load(this: PluginContext, id: string): LoadResult {
      if (isVite) return null
      if (!this.getModuleInfo(id)?.meta?.needsTransform || !fs.existsSync(id)) return null

      const content = fs.readFileSync(id, 'utf8')
      const result = transformSourceFile(id, content, registry, { development, target })
      if (!result.transformed) return null

      console.log(`[ZeroComRollupPlugin] Transformed: ${path.relative(process.cwd(), id)}`)
      const code = emitToJs(id, result.content)
      return { code, map: result.map ?? null }
    },

    // Vite path: transform hook works reliably (no cross-hook meta needed).
    // Returns transformed TypeScript — Vite's esbuild handles TS→JS.
    transform(code: string, id: string, viteOptions?: unknown) {
      if (!isVite) return null
      if (id.includes('node_modules') || !/\.(ts|tsx|js|jsx|mjs)$/.test(id)) return null

      // Derive effective target: explicit option takes precedence, otherwise infer from Vite's ssr flag
      const ssr = typeof viteOptions === 'object' && viteOptions !== null && 'ssr' in viteOptions
        ? (viteOptions as { ssr?: boolean }).ssr
        : undefined
      const effectiveTarget = target ?? (ssr === false ? 'client' : ssr === true ? 'server' : undefined)

      const result = transformSourceFile(id, code, registry, { development, target: effectiveTarget })
      if (!result.transformed) return null

      console.log(`[ZeroComRollupPlugin] Transformed: ${path.relative(process.cwd(), id)}`)
      return { code: result.content, map: result.map ?? null }
    },

    renderChunk(code: string) {
      if (development) return null
      const newCode = applyReplacements(code, compilationId)
      return newCode !== code ? { code: newCode, map: null } : null
    }
  }
}
