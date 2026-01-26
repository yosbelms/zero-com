import { describe, it, expect, beforeEach } from 'vitest'
import { func, handle, call } from '../lib/runtime'

// Runtime functions work at runtime in development mode.
// In production mode, they are transformed by the plugin to inline code.

describe('func()', () => {
  it('should return the function as-is', () => {
    const myFn = () => 'hello'
    const result = func(myFn)
    expect(result).toBe(myFn)
  })

  it('should allow requireContext to be set on returned function', () => {
    const myFn = () => 'hello'
    const result = func(myFn) as any
    result.requireContext = true
    expect(result.requireContext).toBe(true)
  })
})

describe('handle()', () => {
  beforeEach(() => {
    globalThis.ZERO_COM_SERVER_REGISTRY = {}
  })

  it('should look up function from registry and call it', () => {
    const myFn = (a: number, b: number) => a + b
    ;(myFn as any).requireContext = false
    globalThis.ZERO_COM_SERVER_REGISTRY['testFn'] = myFn

    const result = handle('testFn', {}, [2, 3])
    expect(result).toBe(5)
  })

  it('should pass context when requireContext is true', () => {
    let receivedCtx: any = undefined
    let receivedArgs: any[] = []
    const myFn = (ctx: any, ...args: any[]) => {
      receivedCtx = ctx
      receivedArgs = args
      return 'ok'
    }
    ;(myFn as any).requireContext = true
    globalThis.ZERO_COM_SERVER_REGISTRY['testFn'] = myFn

    const ctx = { userId: '123' }
    handle('testFn', ctx, ['a', 'b'])

    expect(receivedCtx).toEqual({ userId: '123' })
    expect(receivedArgs).toEqual(['a', 'b'])
  })

  it('should NOT pass context when requireContext is false', () => {
    let receivedArgs: any[] = []
    const myFn = (...args: any[]) => {
      receivedArgs = args
      return 'ok'
    }
    ;(myFn as any).requireContext = false
    globalThis.ZERO_COM_SERVER_REGISTRY['testFn'] = myFn

    handle('testFn', { userId: '123' }, ['a', 'b'])

    expect(receivedArgs).toEqual(['a', 'b'])
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
