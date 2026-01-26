import { describe, it, expect, beforeEach } from 'vitest'
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
