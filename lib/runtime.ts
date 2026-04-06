import { asyncLocalStorage as storage } from './async-local-storage'

declare global {
  var ZERO_COM_SERVER_REGISTRY: { [funcId: string]: (...args: any[]) => any }
  var ZERO_COM_CLIENT_CALL: (funcId: string, args: any[]) => any
}

// Default server-side implementation: call directly from registry
// This enables server functions to call other server functions without transport.
// If a request context exists (set by handle()), it is propagated automatically.
// If there is no context (e.g. called from NextAuth or other server-only code that
// does not go through handle()), the function is called directly — context() will
// throw inside the function only if the function actually tries to use it.
if (typeof globalThis.ZERO_COM_CLIENT_CALL === 'undefined') {
  globalThis.ZERO_COM_CLIENT_CALL = (funcId: string, args: any[]) => {
    if (!storage) {
      throw new Error('Server function called on client without transport configured. Call call() first.')
    }
    const fn = globalThis.ZERO_COM_SERVER_REGISTRY?.[funcId]
    if (!fn) throw new Error(`Function not found: ${funcId}`)
    const ctx = storage.getStore()
    if (ctx !== undefined) {
      return storage.run(ctx, () => fn(...args))
    }
    return fn(...args)
  }
}

// Get the current context - call this inside server functions
export function context<T = unknown>(): T {
  if (!storage) {
    throw new Error('context() is only available on the server')
  }
  const ctx = storage.getStore()
  if (ctx === undefined) {
    throw new Error('context() called outside of a server function')
  }
  return ctx
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
  if (!storage) {
    throw new Error('handle() is only available on the server')
  }
  return storage.run(ctx, () => fn(...args))
}

// Run a callback within a context, making context() available inside it.
// Use this in server-only code that does not go through handle() (e.g. auth callbacks).
export const runWithContext = <T>(ctx: any, fn: () => T): T => {
  if (!storage) throw new Error('runWithContext() is only available on the server')
  return storage.run(ctx, fn)
}

// Client calls this to set up transport (overrides default server-side behavior)
// In production mode: transformed by plugin to assignment
export const call = (
  fn: (funcId: string, args: any[]) => any
): void => {
  globalThis.ZERO_COM_CLIENT_CALL = fn
}
