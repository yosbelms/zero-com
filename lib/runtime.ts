declare global {
  var ZERO_COM_SERVER_REGISTRY: { [funcId: string]: (...args: any[]) => any }
  var ZERO_COM_CLIENT_CALL: (funcId: string, args: any[]) => any
  var ZERO_COM_CONTEXT_STORAGE: { run: <T>(ctx: any, fn: () => T) => T; getStore: () => any } | undefined
}

// Context storage - only available on server (Node.js)
// Lazily initialized to avoid importing async_hooks on client
function getContextStorage() {
  if (!globalThis.ZERO_COM_CONTEXT_STORAGE) {
    try {
      // Dynamic import to avoid bundling async_hooks for browser
      const { AsyncLocalStorage } = require('async_hooks')
      globalThis.ZERO_COM_CONTEXT_STORAGE = new AsyncLocalStorage()
    } catch {
      // Browser environment - context storage not available
      globalThis.ZERO_COM_CONTEXT_STORAGE = undefined
    }
  }
  return globalThis.ZERO_COM_CONTEXT_STORAGE
}

// Get the current context - call this inside server functions
export function context<T = unknown>(): T {
  const storage = getContextStorage()
  if (!storage) {
    throw new Error('context() is only available on the server')
  }
  const ctx = storage.getStore()
  if (ctx === undefined) {
    throw new Error('context() called outside of a server function')
  }
  return ctx
}

// Default server-side implementation: call directly from registry
// This enables server functions to call other server functions without transport
if (typeof globalThis.ZERO_COM_CLIENT_CALL === 'undefined') {
  globalThis.ZERO_COM_CLIENT_CALL = (funcId: string, args: any[]) => {
    const storage = getContextStorage()
    if (!storage) {
      throw new Error('Server function called on client without transport configured. Call call() first.')
    }
    const ctx = storage.getStore()
    if (ctx === undefined) {
      throw new Error('Server function called outside of request context')
    }
    const fn = globalThis.ZERO_COM_SERVER_REGISTRY?.[funcId]
    if (!fn) throw new Error(`Function not found: ${funcId}`)
    return fn(...args)
  }
}

// func() just returns the function as-is
// In production mode: transformed by plugin to just the inner function
export function func<F extends (...args: any[]) => any>(fn: F): F {
  return fn
}

// handle() stores context in AsyncLocalStorage and calls the function
// In production mode: transformed by plugin to inline code
export const handle = (
  funcId: string,
  ctx: any,
  args: any[]
): any => {
  const fn = globalThis.ZERO_COM_SERVER_REGISTRY?.[funcId]
  if (!fn) {
    throw new Error(`Function not found in registry: ${funcId}`)
  }
  const storage = getContextStorage()
  if (!storage) {
    throw new Error('handle() is only available on the server')
  }
  return storage.run(ctx, () => fn(...args))
}

// Client calls this to set up transport (overrides default server-side behavior)
// In production mode: transformed by plugin to assignment
export const call = (
  fn: (funcId: string, args: any[]) => any
): void => {
  globalThis.ZERO_COM_CLIENT_CALL = fn
}
