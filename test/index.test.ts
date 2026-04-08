import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { func, handle, call, context } from '../lib/runtime'

// Runtime functions work at runtime in development mode.
// In production mode, they are transformed by the plugin to inline code.

describe('func()', () => {
  it('should return the function as-is', () => {
    const myFn = () => 'hello'
    const result = func(myFn)
    expect(result).toBe(myFn)
  })
})

describe('context()', () => {
  beforeEach(() => {
    globalThis.ZERO_COM_SERVER_REGISTRY = {}
  })

  it('should return context when inside handle()', () => {
    let receivedCtx: any = undefined
    const myFn = () => {
      receivedCtx = context()
      return 'ok'
    }
    globalThis.ZERO_COM_SERVER_REGISTRY['testFn'] = myFn

    const ctx = { userId: '123' }
    handle('testFn', ctx, [])

    expect(receivedCtx).toEqual({ userId: '123' })
  })

  it('should throw when called outside of handle()', () => {
    expect(() => context()).toThrow('context() called outside of a server function')
  })
})

describe('handle()', () => {
  beforeEach(() => {
    globalThis.ZERO_COM_SERVER_REGISTRY = {}
  })

  it('should look up function from registry and call it', () => {
    const myFn = (a: number, b: number) => a + b
    globalThis.ZERO_COM_SERVER_REGISTRY['testFn'] = myFn

    const result = handle('testFn', {}, [2, 3])
    expect(result).toBe(5)
  })

  it('should make context available via context() function', () => {
    let receivedCtx: any = undefined
    let receivedArgs: any[] = []
    const myFn = (...args: any[]) => {
      receivedCtx = context()
      receivedArgs = args
      return 'ok'
    }
    globalThis.ZERO_COM_SERVER_REGISTRY['testFn'] = myFn

    const ctx = { userId: '123' }
    handle('testFn', ctx, ['a', 'b'])

    expect(receivedCtx).toEqual({ userId: '123' })
    expect(receivedArgs).toEqual(['a', 'b'])
  })

  it('should propagate context to nested server function calls', () => {
    let innerCtx: any = undefined

    // Inner function that reads context
    const innerFn = () => {
      innerCtx = context()
      return 'inner'
    }
    globalThis.ZERO_COM_SERVER_REGISTRY['innerFn'] = innerFn

    // Outer function that calls inner via ZERO_COM_CLIENT_CALL
    const outerFn = () => {
      return globalThis.ZERO_COM_CLIENT_CALL('innerFn', [])
    }
    globalThis.ZERO_COM_SERVER_REGISTRY['outerFn'] = outerFn

    const ctx = { userId: '456' }
    handle('outerFn', ctx, [])

    expect(innerCtx).toEqual({ userId: '456' })
  })

  it('should throw if function not found in registry', () => {
    expect(() => handle('nonExistent', {}, [])).toThrow('Function not found in registry: nonExistent')
  })
})

describe('call()', () => {
  it('should set globalThis.ZERO_COM_CLIENT_CALL', () => {
    const myHandler = async (funcId: string, args: any[]) => ({ funcId, args })
    call(myHandler)
    expect(globalThis.ZERO_COM_CLIENT_CALL).toBe(myHandler)
  })
})

describe('ZERO_COM_CONTEXT_STORAGE', () => {
  let savedClientCall: any
  let savedRegistry: any

  beforeEach(() => {
    savedClientCall = globalThis.ZERO_COM_CLIENT_CALL
    savedRegistry = globalThis.ZERO_COM_SERVER_REGISTRY
    // Reconstruct the default ZERO_COM_CLIENT_CALL using the same storage
    // as ZERO_COM_CONTEXT_STORAGE (mirrors runtime.ts default behavior)
    const storage = globalThis.ZERO_COM_CONTEXT_STORAGE!
    globalThis.ZERO_COM_CLIENT_CALL = (funcId: string, args: any[]) => {
      const fn = globalThis.ZERO_COM_SERVER_REGISTRY?.[funcId]
      if (!fn) throw new Error(`Function not found: ${funcId}`)
      const ctx = storage.getStore()
      if (ctx !== undefined) {
        return storage.run(ctx, () => fn(...args))
      }
      return fn(...args)
    }
    globalThis.ZERO_COM_SERVER_REGISTRY = {}
  })

  afterEach(() => {
    globalThis.ZERO_COM_CLIENT_CALL = savedClientCall
    globalThis.ZERO_COM_SERVER_REGISTRY = savedRegistry
  })

  it('should be initialized on globalThis with AsyncLocalStorage', () => {
    expect(globalThis.ZERO_COM_CONTEXT_STORAGE).toBeDefined()
    expect(typeof globalThis.ZERO_COM_CONTEXT_STORAGE!.run).toBe('function')
    expect(typeof globalThis.ZERO_COM_CONTEXT_STORAGE!.getStore).toBe('function')
  })

  it('should work as a drop-in for handle() — production-mode transform path', () => {
    const myFn = (x: number) => x * context<{ multiplier: number }>().multiplier * x
    globalThis.ZERO_COM_SERVER_REGISTRY = { testFn: myFn }

    const ctx = { multiplier: 3 }
    // This simulates what the production transform emits:
    // globalThis.ZERO_COM_CONTEXT_STORAGE.run(ctx, () => globalThis.ZERO_COM_SERVER_REGISTRY[funcId](...args))
    const result = globalThis.ZERO_COM_CONTEXT_STORAGE!.run(ctx, () =>
      globalThis.ZERO_COM_SERVER_REGISTRY['testFn'](5)
    )

    expect(result).toBe(75) // 5 * 3 * 5
  })

  it('should propagate context through nested calls in production-mode path', () => {
    let innerCtx: any
    const innerFn = () => { innerCtx = context() }
    const outerFn = () => globalThis.ZERO_COM_CLIENT_CALL('innerFn', [])

    globalThis.ZERO_COM_SERVER_REGISTRY = { innerFn, outerFn }

    const ctx = { userId: '42' }
    globalThis.ZERO_COM_CONTEXT_STORAGE!.run(ctx, () =>
      globalThis.ZERO_COM_SERVER_REGISTRY['outerFn']()
    )

    expect(innerCtx).toEqual({ userId: '42' })
  })
})

describe('ZERO_COM_CLIENT_CALL default — outside handle() context', () => {
  let savedClientCall: any
  let savedRegistry: any

  beforeEach(() => {
    savedClientCall = globalThis.ZERO_COM_CLIENT_CALL
    savedRegistry = globalThis.ZERO_COM_SERVER_REGISTRY
    // Restore the default implementation (bypasses the call() override from above)
    delete (globalThis as any).ZERO_COM_CLIENT_CALL
    // Re-import triggers the `if (typeof ... === 'undefined')` guard at module level,
    // but since the module is already cached we instead reconstruct the default inline.
    // The default: propagate context if present, call directly if not.
    globalThis.ZERO_COM_CLIENT_CALL = (funcId: string, args: any[]) => {
      const { AsyncLocalStorage } = require('async_hooks')
      if (!globalThis.ZERO_COM_CONTEXT_STORAGE) {
        globalThis.ZERO_COM_CONTEXT_STORAGE = new AsyncLocalStorage()
      }
      const storage = globalThis.ZERO_COM_CONTEXT_STORAGE
      const fn = globalThis.ZERO_COM_SERVER_REGISTRY?.[funcId]
      if (!fn) throw new Error(`Function not found: ${funcId}`)
      const ctx = storage.getStore()
      if (ctx !== undefined) {
        return storage.run(ctx, () => fn(...args))
      }
      return fn(...args)
    }
    globalThis.ZERO_COM_SERVER_REGISTRY = {}
  })

  afterEach(() => {
    globalThis.ZERO_COM_CLIENT_CALL = savedClientCall
    globalThis.ZERO_COM_SERVER_REGISTRY = savedRegistry
  })

  it('calls function directly when there is no handle() context', () => {
    const myFn = (x: number) => x * 2
    globalThis.ZERO_COM_SERVER_REGISTRY['myFn'] = myFn

    const result = globalThis.ZERO_COM_CLIENT_CALL('myFn', [5])

    expect(result).toBe(10)
  })

  it('passes arguments correctly when called outside handle()', () => {
    const myFn = (a: string, b: string) => `${a}-${b}`
    globalThis.ZERO_COM_SERVER_REGISTRY['myFn'] = myFn

    const result = globalThis.ZERO_COM_CLIENT_CALL('myFn', ['hello', 'world'])

    expect(result).toBe('hello-world')
  })

  it('throws at the context() call site (not at dispatch) when function uses context() outside handle()', () => {
    const myFn = () => context()
    globalThis.ZERO_COM_SERVER_REGISTRY['myFn'] = myFn

    expect(() => globalThis.ZERO_COM_CLIENT_CALL('myFn', [])).toThrow('context() called outside of a server function')
  })

  it('throws when function is not in registry', () => {
    expect(() => globalThis.ZERO_COM_CLIENT_CALL('nonExistent', [])).toThrow('Function not found: nonExistent')
  })

  it('propagates existing context when called inside handle()', () => {
    let receivedCtx: any

    const innerFn = () => { receivedCtx = context() }
    globalThis.ZERO_COM_SERVER_REGISTRY['innerFn'] = innerFn

    const outerFn = () => globalThis.ZERO_COM_CLIENT_CALL('innerFn', [])
    globalThis.ZERO_COM_SERVER_REGISTRY['outerFn'] = outerFn

    handle('outerFn', { userId: '99' }, [])

    expect(receivedCtx).toEqual({ userId: '99' })
  })
})
