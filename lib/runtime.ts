
declare global {
  var ZERO_COM_SERVER_REGISTRY: { [funcId: string]: (...args: any[]) => any }
  var ZERO_COM_CLIENT_SEND: (funcId: string, args: any[]) => Promise<any>
}

// Branded marker type for context parameter
declare const contextBrand: unique symbol
export type context<T = unknown> = T & { readonly [contextBrand]: never }

// Type helper to remove Context param from function signature
type RemoveContextParam<F> =
  F extends (ctx: context<unknown>, ...args: infer A) => infer R
  ? (...args: A) => R
  : F extends (...args: infer A) => infer R
  ? (...args: A) => R
  : never

// Single unified signature - Context detection happens via type
export function func<F extends (...args: any[]) => any>(fn: F): RemoveContextParam<F> & { server: true }

// Implementation
export function func(fn: (...args: any[]) => any): (...args: any[]) => any {
  (fn as any).requireContext = true
  return fn
}

// Internal implementation - receives the actual function from registry
export const execFunc = (
  sfn: ReturnType<typeof func>,
  ctx: any,
  args: any[]
): ReturnType<typeof sfn> => {
  const fn = sfn as any
  if (fn.requireContext) {
    return fn(ctx, ...args)
  } else {
    return fn(...args)
  }
}

// User-facing function - transformed by plugin to execFunc(globalThis.ZERO_COM_SERVER_REGISTRY[funcId], ctx, args)
export const handle = (
  _funcId: string,
  _ctx: any,
  _args: any[]
): any => {
  throw new Error('handle() was not transformed. Ensure the zero-com plugin is configured.')
}

// User-facing function - transformed by plugin to globalThis.ZERO_COM_CLIENT_SEND = fn
export const send = (
  _fn: (funcId: string, args: any[]) => Promise<any>
): void => {
  throw new Error('send() was not transformed. Ensure the zero-com plugin is configured.')
}
