import * as api from './api'

export async function fetchUserData(userId: string) {
  const user = await api.getUser(userId)
  return user
}

export async function registerUser(name: string, email: string) {
  const user = await api.createUser(name, email)
  return user
}

// This should NOT be transformed (not a server function)
export function doubleValue(x: number) {
  return api.helperFunction(x)
}
