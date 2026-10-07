/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*==========================================
 * SIGN-IN STATE FOR THE MOBILE APPS (AGL-3620, AGL-3618).
 *
 * One Firebase user, read through `onIdTokenChanged`. `ready` is false until
 * Firebase has restored (or not) the persisted session, so the shell never
 * flashes the sign-in screen at someone who is signed in. The helpers are
 * plain functions over an `Auth` so the POS app, which has no provider tree
 * of its own, uses the same ones.
 *=========================================*/

import {
  GoogleAuthProvider,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from '@firebase/auth'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { mobileBrandName } from './config'
import { getMobileFirebase } from './firebase'

/** The words a person should read for a Firebase sign-in error. */
export function signInErrorMessage(error: unknown): string {
  const code = String((error as { code?: string } | null)?.code ?? '')
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return `That email and password do not match an ${mobileBrandName()} account.`
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes, then try again.'
    case 'auth/user-disabled':
      return 'This account is turned off. Contact your workspace owner.'
    case 'auth/network-request-failed':
      return `${mobileBrandName()} could not be reached. Check the connection and try again.`
    case 'auth/multi-factor-auth-required':
      return 'This account uses two-step verification. Sign in on the web console to finish setting up this device.'
    default:
      return 'Sign-in did not work. Try again.'
  }
}

export async function signInWithEmail(auth: Auth, email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password)
  return credential.user
}

/** Completes a native Google sign-in with the Google ID token it returned. */
export async function signInWithGoogleIdToken(auth: Auth, idToken: string): Promise<User> {
  const credential = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken))
  return credential.user
}

export async function requestPasswordReset(auth: Auth, email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim())
}

/**
 * Signs out. `beforeSignOut` runs first, while the user can still be named:
 * the console session cookie, the device's push registration.
 */
export async function signOutEverywhere(auth: Auth, beforeSignOut?: () => Promise<void>): Promise<void> {
  await beforeSignOut?.().catch(() => undefined)
  await signOut(auth)
}

/** The signed-in user, `undefined` until Firebase has restored the session. */
export function useFirebaseUser(auth: Auth): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(auth.currentUser ?? undefined)
  useEffect(() => onIdTokenChanged(auth, (next) => setUser(next)), [auth])
  return user
}

export interface MobileAuthState {
  user: User | null
  ready: boolean
  auth: Auth
  signIn(email: string, password: string): Promise<void>
  resetPassword(email: string): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<MobileAuthState | null>(null)

/** Work to finish before a sign-out, registered by the shell (push, console session). */
const signOutTasks = new Set<() => Promise<void>>()

export function onBeforeSignOut(task: () => Promise<void>): () => void {
  signOutTasks.add(task)
  return () => signOutTasks.delete(task)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth } = getMobileFirebase()
  const user = useFirebaseUser(auth)

  const value = useMemo<MobileAuthState>(
    () => ({
      user: user ?? null,
      ready: user !== undefined,
      auth,
      async signIn(email, password) {
        await signInWithEmail(auth, email, password)
      },
      async resetPassword(email) {
        await requestPasswordReset(auth, email)
      },
      async signOut() {
        await signOutEverywhere(auth, async () => {
          await Promise.all([...signOutTasks].map((task) => task().catch(() => undefined)))
        })
      },
    }),
    [auth, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useMobileAuth(): MobileAuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useMobileAuth needs <AuthProvider> around it')
  return value
}
