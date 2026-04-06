import { AsyncLocalStorage } from 'async_hooks'
export const asyncLocalStorage: AsyncLocalStorage<any> | undefined = new AsyncLocalStorage()
