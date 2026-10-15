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

/**
 * AGL-3816 — the native apps' console hand-off store: what a code is bound to,
 * and that it is redeemed once, by the app that holds the verifier, at the
 * address it was minted for, inside its window.
 */

jest.mock('./firebase-admin', () => ({ __esModule: true, default: { app: () => ({}) } }))
const mockCreateToken = jest.fn()
jest.mock('firebase-admin/app', () => ({ __esModule: true, getApp: () => ({}) }))
jest.mock('firebase-admin/app-check', () => ({
  __esModule: true,
  getAppCheck: () => ({ createToken: (...a: unknown[]) => mockCreateToken(...a) }),
}))

import { createHash } from 'crypto'
import {
  authorizeNativeHandoff,
  isLoopbackRedirect,
  isNativeHandoffRedirect,
  mintNativeAppCheckToken,
  NATIVE_APP_CHECK_TTL_MS,
  nativeDesktopAppCheckAppId,
  isPkceChallenge,
  isPkceVerifier,
  nativeHandoffKey,
  NATIVE_HANDOFF_TTL_MS,
  pkceChallengeFor,
  redeemNativeHandoff,
} from './native-handoff'

/** An in-memory Firestore with the calls the store makes. */
function memoryFirestore() {
  const store: Record<string, Record<string, unknown>> = {}
  const docRef = (id: string) => ({
    __id: id,
    create: async (value: Record<string, unknown>) => {
      if (store[id]) throw new Error('ALREADY_EXISTS')
      store[id] = { ...value }
    },
  })
  const firestore = {
    collection: () => ({ doc: (id: string) => docRef(id) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: async (ref: { __id: string }) => ({
          exists: Object.prototype.hasOwnProperty.call(store, ref.__id),
          data: () => store[ref.__id],
        }),
        set: (ref: { __id: string }, value: Record<string, unknown>) => {
          store[ref.__id] = { ...(store[ref.__id] ?? {}), ...value }
        },
        delete: (ref: { __id: string }) => {
          delete store[ref.__id]
        },
      }),
  }
  return { store, firestore: firestore as unknown as FirebaseFirestore.Firestore }
}

const VERIFIER = 'v'.repeat(43) + '-._~'
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
const NOW = 1_800_000_000_000

describe('what a hand-off may be delivered to', () => {
  it('accepts only the apps’ own schemes and a loopback listener', () => {
    expect(isNativeHandoffRedirect('aglyn://auth/handoff')).toBe(true)
    expect(isNativeHandoffRedirect('aglyn-pos://auth/handoff')).toBe(true)
    expect(isNativeHandoffRedirect('http://127.0.0.1:53682/handoff')).toBe(true)
    expect(isNativeHandoffRedirect('http://[::1]:53682/handoff')).toBe(true)
    for (const refused of [
      'https://evil.example/handoff',
      'aglyn://auth/handoff/extra',
      'http://localhost:53682/handoff',
      'http://127.0.0.1:80/handoff',
      'http://127.0.0.1:53682/other',
      'http://127.0.0.1.evil.example:53682/handoff',
      'aglyn-evil://auth/handoff',
      42,
    ]) {
      expect(isNativeHandoffRedirect(refused)).toBe(false)
    }
  })

  it('reads PKCE values by RFC 7636’s shapes', () => {
    expect(isPkceChallenge(CHALLENGE)).toBe(true)
    expect(pkceChallengeFor(VERIFIER)).toBe(CHALLENGE)
    expect(isPkceChallenge('short')).toBe(false)
    expect(isPkceVerifier(VERIFIER)).toBe(true)
    expect(isPkceVerifier('x'.repeat(42))).toBe(false)
    expect(isPkceVerifier('x'.repeat(129))).toBe(false)
  })
})

describe('a code', () => {
  async function minted(tenantId: string | null = null) {
    const memory = memoryFirestore()
    const { code, expiresAtMs } = await authorizeNativeHandoff({
      uid: 'u1',
      tenantId,
      challenge: CHALLENGE,
      redirectUri: 'aglyn://auth/handoff',
      nowMs: NOW,
      firestore: memory.firestore,
    })
    return { ...memory, code, expiresAtMs }
  }

  it('is stored only as its digest, with what it is bound to', async () => {
    const { store, code, expiresAtMs } = await minted('aglyn-org-1')
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Object.keys(store)).toEqual([nativeHandoffKey(code)])
    expect(JSON.stringify(store)).not.toContain(code)
    expect(store[nativeHandoffKey(code)]).toMatchObject({
      uid: 'u1',
      tenantId: 'aglyn-org-1',
      challenge: CHALLENGE,
      redirectUri: 'aglyn://auth/handoff',
      expiresAtMs: NOW + NATIVE_HANDOFF_TTL_MS,
    })
    expect(expiresAtMs).toBe(NOW + NATIVE_HANDOFF_TTL_MS)
  })

  it('redeems once, for the app holding the verifier, in the pool it was minted in', async () => {
    const { firestore, code } = await minted('aglyn-org-1')
    const first = await redeemNativeHandoff({
      code, verifier: VERIFIER, redirectUri: 'aglyn://auth/handoff', nowMs: NOW + 1000, firestore,
    })
    expect(first).toEqual({ ok: true, uid: 'u1', tenantId: 'aglyn-org-1' })
    const again = await redeemNativeHandoff({
      code, verifier: VERIFIER, redirectUri: 'aglyn://auth/handoff', nowMs: NOW + 2000, firestore,
    })
    expect(again).toEqual({ ok: false, reason: 'absent' })
  })

  it('is refused, and spent, with another verifier', async () => {
    const { firestore, store, code } = await minted()
    const wrong = await redeemNativeHandoff({
      code, verifier: 'w'.repeat(43), redirectUri: 'aglyn://auth/handoff', nowMs: NOW, firestore,
    })
    expect(wrong).toEqual({ ok: false, reason: 'verifier' })
    expect(store).toEqual({})
  })

  it('is refused at another return address', async () => {
    const { firestore, code } = await minted()
    const elsewhere = await redeemNativeHandoff({
      code, verifier: VERIFIER, redirectUri: 'aglyn-pos://auth/handoff', nowMs: NOW, firestore,
    })
    expect(elsewhere).toEqual({ ok: false, reason: 'redirect' })
  })

  it('is refused once its window has passed', async () => {
    const { firestore, code } = await minted()
    const late = await redeemNativeHandoff({
      code, verifier: VERIFIER, redirectUri: 'aglyn://auth/handoff', nowMs: NOW + NATIVE_HANDOFF_TTL_MS + 1, firestore,
    })
    expect(late).toEqual({ ok: false, reason: 'expired' })
  })
})

describe('the desktop’s App Check token', () => {
  it('is minted for the dedicated desktop app when one is configured, else the console’s web app', async () => {
    expect(nativeDesktopAppCheckAppId({ NATIVE_DESKTOP_APP_CHECK_APP_ID: '1:1:web:desk', NEXT_PUBLIC_FIREBASE_APP_ID: '1:1:web:console' })).toBe('1:1:web:desk')
    expect(nativeDesktopAppCheckAppId({ NEXT_PUBLIC_FIREBASE_APP_ID: '1:1:web:console' })).toBe('1:1:web:console')
    expect(nativeDesktopAppCheckAppId({})).toBeNull()
    mockCreateToken.mockResolvedValueOnce({ token: 'minted', ttlMillis: NATIVE_APP_CHECK_TTL_MS })
    const minted = await mintNativeAppCheckToken({ nowMs: NOW, env: { NATIVE_DESKTOP_APP_CHECK_APP_ID: '1:1:web:desk' } })
    expect(minted).toEqual({ token: 'minted', expiresAtMs: NOW + NATIVE_APP_CHECK_TTL_MS })
    expect(mockCreateToken).toHaveBeenCalledWith('1:1:web:desk', { ttlMillis: NATIVE_APP_CHECK_TTL_MS })
    expect(await mintNativeAppCheckToken({ env: {} })).toBeNull()
  })

  it('rides only the desktop’s loopback return', () => {
    expect(isLoopbackRedirect('http://127.0.0.1:53682/handoff')).toBe(true)
    expect(isLoopbackRedirect('aglyn://auth/handoff')).toBe(false)
  })
})
