import { getUser as fetchUser, createUser as registerNewUser } from './api'

export async function getProfile(userId: string) {
  const user = await fetchUser(userId)
  return user
}

export async function signUp(name: string, email: string) {
  const user = await registerNewUser(name, email)
  return user
}
