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
'use client'

import { FIREBASE_AUTH_EMULATOR_ENABLED } from '@aglyn/shared-data-enums'
import { useAuth, useUser } from '@aglyn/tenant-feature-instance'
import { signInWithCustomToken, signOut } from 'firebase/auth'
import { useEffect, useRef } from 'react'
import { tombstoneEndsSession } from '../app/api/auth/session/session-tombstone'
import {
  clearInteractiveSignIn,
  consumeInteractiveSignIn,
  consumeInteractiveSignOut,
} from '../utils/interactive-signin'

/**
 * Cross-subdomain session sync (AGL-236). Firebase client auth is
 * per-origin, so each {org}.aglyn.io workspace starts signed out even
 * when app.aglyn.io is authenticated. The parent-domain `__session`
 * cookie is the source of truth for the workspace session:
 *
 * - interactive sign-in (signed-out → signed-in transition) → mint the
 *   cookie, exactly once per uid — NOT on every auth emission, which
 *   used to race a re-mint past the sign-out DELETE and resurrect the
 *   session;
 * - load already signed in (persistence restore) → VALIDATE the cookie:
 *   a 401 means the user signed out on another subdomain, so this
 *   origin signs out too (the propagation half of the spec);
 * - load signed out, cookie present → silent sign-in via the
 *   custom-token exchange;
 * - explicit sign-out (interactive-signout marker set) → clear the
 *   cookie (the signout page also clears it before signOut so a hard
 *   navigation can't strand it);
 * - auth dropped WITHOUT a marker (token-refresh failure in a suspended
 *   tab) → restore from the shared cookie instead of retiring it, so a
 *   zombie tab can't tombstone every workspace's session (AGL-543).
 */
export function useSessionCookie(): void {
  const auth = useAuth()
  const { data: user } = useUser()
  const hadUser = useRef(false)
  const sawInitialState = useRef(false)
  const mintedForUid = useRef<string | null>(null)
  const restoreAttempted = useRef(false)

  useEffect(() => {
    // Emulator mode (dev/e2e): the Auth emulator does not support
    // session cookies, so the mint below always fails — and the
    // restore-validation branch would then read every fresh page load's
    // missing cookie as "signed out elsewhere" and sign the restored
    // user out (the long-standing "authenticated emulator sessions
    // don't survive a reload" wall). Localhost is single-origin; there
    // is no cross-subdomain session to sync.
    if (FIREBASE_AUTH_EMULATOR_ENABLED) return
    // reactfire emits `undefined` until auth resolves; the first real
    // value (user or null) is the persisted state, not a transition.
    if (user === undefined) return
    const isInitialState = !sawInitialState.current
    sawInitialState.current = true

    let active = true
    void (async () => {
      if (user) {
        const wasSignedIn = hadUser.current
        hadUser.current = true

        if (isInitialState) {
          // The mobile Google flow (signInWithRedirect) completes on a
          // fresh page load, so an interactive sign-in surfaces here as an
          // "initial state" — indistinguishable from a persistence restore.
          // If the user just signed in on this tab, MINT the shared cookie
          // rather than validating a stale one; otherwise a leftover
          // `signed-out` tombstone reads as "signed out elsewhere" and logs
          // them back out ~seconds after login (AGL-463).
          if (consumeInteractiveSignIn()) {
            mintedForUid.current = user.uid
            try {
              const idToken = await user.getIdToken()
              await fetch('/api/auth/session', {
                method: 'POST',
                headers: { Authorization: `Bearer ${idToken}` },
              })
            } catch {
              // Mint is best-effort; this origin stays signed in.
            }
            return
          }
          // Genuine restore — defer to the shared cookie, but only an
          // EXPLICIT sign-out elsewhere (tombstone) or a revocation may end
          // this session. A merely absent/expired cookie is ambiguous — a
          // mint that raced a hard navigation, the 14-day TTL lapsing, a
          // blocked fetch — so re-mint from the live local session instead
          // of signing out.
          try {
            const response = await fetch('/api/auth/session')
            if (!active || response.ok || response.status !== 401) return
            const payload = await response.json().catch(() => null)
            const reason = payload?.reason
            // A revocation always ends the session. A `signed-out`
            // tombstone only does when it is NEWER than this session's last
            // sign-in — otherwise it is stale (a prior sign-out whose
            // re-login mint failed/raced) and would otherwise log the user
            // out on a plain refresh (AGL-624); heal it by re-minting.
            if (reason === 'revoked') {
              if (active) await signOut(auth)
              return
            }
            if (reason === 'signed-out') {
              const signedOutAt = Number(payload?.signedOutAt) || 0
              const lastSignInMs =
                Date.parse(user.metadata?.lastSignInTime ?? '') || 0
              if (tombstoneEndsSession(signedOutAt, lastSignInMs)) {
                if (active) await signOut(auth)
                return
              }
            }
            mintedForUid.current = user.uid
            const idToken = await user.getIdToken()
            await fetch('/api/auth/session', {
              method: 'POST',
              headers: { Authorization: `Bearer ${idToken}` },
            })
          } catch {
            // Network trouble never signs anyone out.
          }
          return
        }
        if (!wasSignedIn && mintedForUid.current !== user.uid) {
          // Interactive sign-in on this origin (no reload — popup/email) →
          // share the session. The redirect marker is consumed here too so
          // a same-tab flow can't leave it set for a later restore.
          clearInteractiveSignIn()
          mintedForUid.current = user.uid
          try {
            const idToken = await user.getIdToken()
            await fetch('/api/auth/session', {
              method: 'POST',
              headers: { Authorization: `Bearer ${idToken}` },
            })
          } catch {
            // Mint is best-effort; the current origin stays signed in.
          }
        }
        return
      }

      if (hadUser.current) {
        hadUser.current = false
        mintedForUid.current = null
        if (consumeInteractiveSignOut()) {
          // Explicit sign-out: retire the shared session.
          await fetch('/api/auth/session', { method: 'DELETE' }).catch(
            () => undefined,
          )
          return
        }
        // The SDK dropped the user without anyone asking — typically a
        // suspended tab whose ID token expired and whose refresh failed
        // (AGL-543). The shared cookie is the source of truth here:
        // restore this tab from it instead of tombstoning every
        // workspace's session. A genuine sign-out elsewhere reads back
        // as 401 signed-out, so this can never resurrect one.
        try {
          const response = await fetch('/api/auth/session')
          if (!response.ok || !active) return
          const payload = await response.json()
          if (payload?.token && active) {
            await signInWithCustomToken(auth, payload.token)
          }
        } catch {
          // Network trouble never signs anyone out; the next load's
          // restore branch gets another chance.
        }
        return
      }
      if (restoreAttempted.current) return
      restoreAttempted.current = true
      try {
        const response = await fetch('/api/auth/session')
        if (!response.ok || !active) return
        const payload = await response.json()
        if (payload?.token && active) {
          await signInWithCustomToken(auth, payload.token)
        }
      } catch {
        // no valid shared session — the sign-in page takes it from here
      }
    })()
    return () => {
      active = false
    }
  }, [auth, user])
}

export default useSessionCookie
