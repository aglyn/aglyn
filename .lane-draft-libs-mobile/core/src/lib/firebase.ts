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

import AsyncStorage from '@react-native-async-storage/async-storage'
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectAuthEmulator,
  getAuth,
  getReactNativePersistence,
  GoogleAuthProvider,
  initializeAuth,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import type { MobileConfig } from './config'

/*==========================================
 * FIREBASE ON A PHONE (AGL-3618).
 *
 * The same Firebase project and the same accounts as the console: the JS
 * SDK, with the session persisted in AsyncStorage so the app stays signed in
 * across launches. Firestore reads go through the client SDK under the same
 * security rules the console reads under; there is no admin path here.
 *
 * The app is one process with one signed-in user, so this keeps one app and
 * one Auth instance per process.
 *=========================================*/

export interface MobileFirebase {
  app: FirebaseApp
  auth: Auth
  firestore: Firestore
}

let instance: MobileFirebase | null = null

export function mobileFirebase(config: MobileConfig): MobileFirebase {
  if (instance) return instance
  const app = getApps().length ? getApp() : initializeApp(config.firebase)
  let auth: Auth
  try {
    auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })
  } catch {
    // Fast Refresh re-runs this module against an app that already has Auth.
    auth = getAuth(app)
  }
  const firestore = getFirestore(app)
  if (config.authEmulatorHost) {
    connectAuthEmulator(auth, `http://${config.authEmulatorHost}`, { disableWarnings: true })
  }
  if (config.firestoreEmulatorHost) {
    const [host, port] = config.firestoreEmulatorHost.split(':')
    connectFirestoreEmulator(firestore, host, Number(port))
  }
  instance = { app, auth, firestore }
  return instance
}

/** The signed-in user, `undefined` until Firebase has restored the session. */
export function useFirebaseUser(auth: Auth): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(auth.currentUser ?? undefined)
  useEffect(() => onIdTokenChanged(auth, (next) => setUser(next)), [auth])
  return user
}

/** The words a person should read for a Firebase sign-in error. */
export function signInErrorMessage(error: unknown): string {
  const code = String((error as { code?: string } | null)?.code ?? '')
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'That email and password do not match an Aglyn account.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes, then try again.'
    case 'auth/user-disabled':
      return 'This account is turned off. Contact your workspace owner.'
    case 'auth/network-request-failed':
      return 'Aglyn could not be reached. Check the connection and try again.'
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

export async function signOutEverywhere(auth: Auth, beforeSignOut?: () => Promise<void>): Promise<void> {
  // The console session cookie first, while the user can still be named.
  await beforeSignOut?.().catch(() => undefined)
  await signOut(auth)
}
