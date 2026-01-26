
declare global {
  var ZERO_COM_SERVER_REGISTRY: { [funcId: string]: (...args: any[]) => any }
  var ZERO_COM_CLIENT_CALL: (funcId: string, args: any[]) => Promise<any>
}

// Branded marker type for context parameter
declare const contextBrand: unique symbol
export type context<T = unknown> = T & { readonly [contextBrand]: never }

// Type helper to remove context param from function signature
type RemoveContextParam<F> =
  F extends (ctx: infer C, ...args: infer A) => infer R
  ? C extends context<unknown>
    ? (...args: A) => R
    : F
  : F

// Single unified signature - Context detection happens via type
export function func<F extends (...args: any[]) => any>(fn: F): RemoveContextParam<F>

// Implementation
// In development mode: works at runtime, returns the function as-is.
// In production mode: transformed by plugin to just the inner function.
// The plugin appends code to register the function and set requireContext.
export function func(fn: (...args: any[]) => any): (...args: any[]) => any {
  return fn
}

// In development mode: works at runtime, looks up function and calls it.
// In production mode: transformed by plugin to inline code.
export const handle = (
  funcId: string,
  ctx: any,
  args: any[]
): any => {
  const fn = globalThis.ZERO_COM_SERVER_REGISTRY[funcId] as any
  if (!fn) {
    throw new Error(`Function not found in registry: ${funcId}`)
  }
  if (fn.requireContext) {
    return fn(ctx, ...args)
  } else {
    return fn(...args)
  }
}

// In development mode: works at runtime, sets the client call handler.
// In production mode: transformed by plugin to assignment.
export const call = (
  fn: (funcId: string, args: any[]) => Promise<any>
): void => {
  globalThis.ZERO_COM_CLIENT_CALL = fn
}
