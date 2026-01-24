import { func, context } from 'zero-com'

export const getUser = func((id: string) => {
  return { id, name: 'Test User' }
})

export const createUser = func((name: string, email: string) => {
  return { id: '123', name, email }
})

export const getUserWithContext = func((ctx: context<{ userId: string }>, id: string) => {
  return { id, requestedBy: ctx.userId }
})

// Non-server function - should not be transformed
export const helperFunction = (x: number) => x * 2
