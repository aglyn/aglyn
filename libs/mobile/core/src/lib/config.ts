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
 * WHAT A MOBILE APP IS STARTED WITH (AGL-3620, AGL-3618).
 *
 * Each app reads its `EXPO_PUBLIC_*` build variables and hands them here
 * once, before anything signs in, so the libraries never read an app's env
 * themselves. Expo inlines `process.env.EXPO_PUBLIC_*` at bundle time only
 * when each one is spelled out in full, so the app passes `process.env`
 * members by name and this module stays pure: a spec hands it a record.
 *
 * The Firebase values are the same public web config the console builds
 * with (`NEXT_PUBLIC_FIREBASE_*`); none of them is a secret.
 *=========================================*/

export interface MobileFirebaseOptions {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
  storageBucket?: string
  messagingSenderId?: string
}

/** Which app this is: stamped on device registrations. */
export type MobileAppId = 'aglyn' | 'aglyn-pos'

export interface MobileConfig {
  app: MobileAppId
  /** The console origin every API call and WebView page is on. */
  consoleOrigin: string
  firebase: MobileFirebaseOptions
  /** `host:port` of the local Auth emulator, when the app runs against one. */
  authEmulatorHost: string | null
  /** `host:port` of the local Firestore emulator. */
  firestoreEmulatorHost: string | null
  /**
   * Google sign-in, offered only when its OAuth client ids are configured.
   * Hidden rather than broken until then.
   */
  google: { iosClientId: string; webClientId: string } | null
  /**
   * The product name the app's copy says, from `EXPO_PUBLIC_BRAND_NAME`: the
   * mobile twin of the web's `PLATFORM_BRAND_NAME`, so a self-hosted or
   * white-label build renames the app without editing source (AGL-2153).
   */
  brandName?: string
}

export interface MobileEnv {
  EXPO_PUBLIC_CONSOLE_URL?: string
  EXPO_PUBLIC_FIREBASE_API_KEY?: string
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?: string
  EXPO_PUBLIC_FIREBASE_PROJECT_ID?: string
  EXPO_PUBLIC_FIREBASE_APP_ID?: string
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?: string
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string
  EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST?: string
  EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST?: string
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?: string
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?: string
  EXPO_PUBLIC_BRAND_NAME?: string
}

export const DEFAULT_CONSOLE_ORIGIN = 'https://app.aglyn.com'

/** The default of `PLATFORM_BRAND_NAME` (libs/aglyn platform-brand.ts), mirrored for the native build. */
export const DEFAULT_BRAND_NAME = 'Aglyn'

const clean = (value: string | undefined): string => (value ?? '').trim()

/** `host:port`, or null for anything else. */
function hostPort(value: string | undefined): string | null {
  const raw = clean(value).replace(/^https?:\/\//, '')
  return /^[A-Za-z0-9.-]+:\d{2,5}$/.test(raw) ? raw : null
}

/** True for the hosts a local development stack runs on. */
export function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    // The Android emulator's name for the Mac it runs on.
    host === '10.0.2.2' ||
    host.endsWith('.localhost')
  )
}

/** An `https:` origin, or `http:` for a local stack only. */
export function normalizeConsoleOrigin(value: string | undefined): string {
  const raw = clean(value).replace(/\/+$/, '')
  if (!raw) return DEFAULT_CONSOLE_ORIGIN
  const match = /^(https?):\/\/([A-Za-z0-9.-]+)(:\d{2,5})?$/.exec(raw)
  if (!match) throw new Error(`EXPO_PUBLIC_CONSOLE_URL is not an origin: ${raw}`)
  const [, scheme, host] = match
  if (scheme === 'http' && !isLocalHost(host.toLowerCase())) {
    throw new Error('EXPO_PUBLIC_CONSOLE_URL must be https outside a local stack.')
  }
  return raw.toLowerCase()
}

export function readMobileConfig(env: MobileEnv, app: MobileAppId): MobileConfig {
  const iosClientId = clean(env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID)
  const webClientId = clean(env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID)
  const storageBucket = clean(env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET)
  const messagingSenderId = clean(env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID)
  return {
    app,
    consoleOrigin: normalizeConsoleOrigin(env.EXPO_PUBLIC_CONSOLE_URL),
    firebase: {
      apiKey: clean(env.EXPO_PUBLIC_FIREBASE_API_KEY),
      authDomain: clean(env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN),
      projectId: clean(env.EXPO_PUBLIC_FIREBASE_PROJECT_ID),
      appId: clean(env.EXPO_PUBLIC_FIREBASE_APP_ID),
      ...(storageBucket ? { storageBucket } : {}),
      ...(messagingSenderId ? { messagingSenderId } : {}),
    },
    authEmulatorHost: hostPort(env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST),
    firestoreEmulatorHost: hostPort(env.EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST),
    google: iosClientId && webClientId ? { iosClientId, webClientId } : null,
    brandName: clean(env.EXPO_PUBLIC_BRAND_NAME) || DEFAULT_BRAND_NAME,
  }
}

/** What is missing for the app to sign anyone in, in words for a build log. */
export function mobileConfigProblems(config: MobileConfig): string[] {
  const problems: string[] = []
  if (!config.firebase.apiKey) problems.push('EXPO_PUBLIC_FIREBASE_API_KEY is not set.')
  if (!config.firebase.projectId) problems.push('EXPO_PUBLIC_FIREBASE_PROJECT_ID is not set.')
  if (!config.firebase.appId) problems.push('EXPO_PUBLIC_FIREBASE_APP_ID is not set.')
  if (!config.firebase.authDomain) problems.push('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN is not set.')
  // A production build pointed at an emulator would sign nobody in.
  if (!isLocalHost(new URL(config.consoleOrigin).hostname)) {
    if (config.authEmulatorHost) problems.push('The Auth emulator is set for a non-local console.')
    if (config.firestoreEmulatorHost) {
      problems.push('The Firestore emulator is set for a non-local console.')
    }
  }
  return problems
}

let current: MobileConfig | null = null

/** Called once by the app, before anything renders. */
export function configureMobile(config: MobileConfig): void {
  current = { ...config, consoleOrigin: normalizeConsoleOrigin(config.consoleOrigin) }
}

export function getMobileConfig(): MobileConfig {
  if (!current) throw new Error('configureMobile() has not run; the app calls it before rendering')
  return current
}

/** Test seam. */
/** The product name for copy; the default before `configureMobile()` runs (a test, a crash screen). */
export function mobileBrandName(): string {
  return current?.brandName || DEFAULT_BRAND_NAME
}

export function resetMobileConfig(): void {
  current = null
}
