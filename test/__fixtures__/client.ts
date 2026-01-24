import { getUser, createUser, getUserWithContext, helperFunction } from './api'

export async function fetchUserData(userId: string) {
  const user = await getUser(userId)
  return user
}

export async function registerUser(name: string, email: string) {
  const user = await createUser(name, email)
  return user
}

export async function fetchWithContext(id: string) {
  const result = await getUserWithContext(id)
  return result
}

// This should NOT be transformed (not a server function)
export function doubleValue(x: number) {
  return helperFunction(x)
}
