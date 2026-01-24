import { describe, it, expect, beforeEach } from 'vitest'
import { func, execFunc, handle, call, context } from '../lib/runtime'

beforeEach(() => {
  globalThis.ZERO_COM_SERVER_REGISTRY = {}
})

describe('func()', () => {
  describe('without context', () => {
    it('should wrap a function with no arguments', () => {
      const fn = func(() => 'hello')
      expect(fn()).toBe('hello')
    })

    it('should wrap a function with arguments', () => {
      const fn = func((a: number, b: number) => a + b)
      expect(fn(2, 3)).toBe(5)
    })

    it('should set requireContext to true', () => {
      const fn = func((a: number) => a * 2) as any
      expect(fn.requireContext).toBe(true)
    })
  })

  describe('with Context type (build-time detection)', () => {
    it('should wrap a function with Context param', () => {
      // Context type is detected at build time, at runtime it just wraps
      const fn = func((ctx: context<{ userId: string }>, id: string) => `${ctx?.userId ?? 'null'}-${id}`)
      // When called directly at runtime without build transform, first arg goes to ctx, second to id
      // This tests the raw runtime behavior - build plugin would transform call sites
      expect((fn as any)({ userId: 'test' } as any, '123')).toBe('test-123')
    })

    it('should set requireContext to true', () => {
      const fn = func((ctx: context<any>, a: number) => a * 2) as any
      expect(fn.requireContext).toBe(true)
    })
  })
})

describe('execFunc()', () => {
  describe('with requireContext = true (set by func())', () => {
    it('should pass context as first argument', () => {
      type Ctx = { userId: string }
      const fn = func((ctx: Ctx, id: string) => `${ctx.userId}-${id}`)
      const result = execFunc(fn, { userId: 'user1' }, ['123'])
      expect(result).toBe('user1-123')
    })

    it('should pass context followed by other args', () => {
      let receivedCtx: any
      let receivedArgs: any[] = []
      const fn = func((ctx: any, ...args: any[]) => {
        receivedCtx = ctx
        receivedArgs = args
        return 'ok'
      })
      execFunc(fn, { userId: '123' }, ['a', 'b'])
      expect(receivedCtx).toEqual({ userId: '123' })
      expect(receivedArgs).toEqual(['a', 'b'])
    })
  })

  describe('without requireContext (plain function)', () => {
    it('should execute function without passing context', () => {
      const fn = ((a: number, b: number) => a + b) as any
      fn.requireContext = false
      const result = execFunc(fn, { userId: '123' }, [2, 3])
      expect(result).toBe(5)
    })

    it('should not pass context to function without requireContext flag', () => {
      let receivedArgs: any[] = []
      const fn = ((...args: any[]) => {
        receivedArgs = args
        return 'ok'
      }) as any
      fn.requireContext = false
      execFunc(fn, { userId: '123' }, ['a', 'b'])
      expect(receivedArgs).toEqual(['a', 'b'])
    })
  })
})

describe('handle()', () => {
  it('should throw if not transformed by plugin', () => {
    expect(() => handle('testFn', {}, [])).toThrow('handle() was not transformed. Ensure the zero-com plugin is configured.')
  })
})

describe('call()', () => {
  it('should throw if not transformed by plugin', () => {
    expect(() => call(async () => ({}))).toThrow('call() was not transformed. Ensure the zero-com plugin is configured.')
  })
})
