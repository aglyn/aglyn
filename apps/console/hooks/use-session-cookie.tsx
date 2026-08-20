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
import clearServiceWorkerCaches from '../utils/clear-service-worker-caches'
import {
  captureReauthIdentity,
  requestSessionReauth,
} from '../utils/session-reauth'

/**
 * Mints the shared `__session` cookie, and reports whether it worked
 * (AGL-1142).
 *
 * Every mint site used to be `try { await fetch(…) } catch {}` with the
 * response discarded, and `mintedForUid` set BEFORE the request. That treats
 * "refused" as "done": `POST /api/auth/session` answers 401 for an
 * unverifiable token or a failed `createSessionCookie`, and 403 for an
 * unverified email — and `await fetch(...)` RESOLVES on all of those rather
 * than throwing, so the catch never ran. Having marked the uid as minted, the
 * tab then never tried again.
 *
 * That is how a sign-out tombstone survives an interactive sign-in, which is
 * the nine-day cookie measured on production 2026-07-31: nothing overwrote it,
 * and nothing noticed.
 *
 * On failure the uid is cleared rather than left set, so a later auth emission
 * gets another attempt — the mint is still best-effort and still never signs
 * anyone out, but a refusal is no longer indistinguishable from success.
 */
async function mintSession(
  user: { uid: string; getIdToken: () => Promise<string> },
  mintedForUid: { current: string | null },
): Promise<boolean> {
  try {
    const idToken = await user.getIdToken()
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    })
    if (!response.ok) {
      mintedForUid.current = null
      const payload = await response.json().catch(() => null)
      // Named, like the AGL-467 server-side mint-failure log. A silent refusal
      // here is invisible for as long as the tombstone lives.
      console.warn(
        '[auth/session] mint refused',
        JSON.stringify({
          status: response.status,
          reason: payload?.reason ?? null,
        }),
      )
      return false
    }
    mintedForUid.current = user.uid
    return true
  } catch {
    // Network trouble: still best effort, but do not claim it happened.
    mintedForUid.current = null
    return false
  }
}

/**
 * Cross-subdomain session sync (AGL-236). Firebase client auth is
 * per-origin, so each {org}.aglyn.com workspace starts signed out even
 * when app.aglyn.com is authenticated. The parent-domain `__session`
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
  // Set right after a SILENT custom-token restore (cross-subdomain / a tab in
  // its own storage partition, e.g. an automation browser). The very next
  // auth emission would otherwise be mistaken for an interactive sign-in and
  // re-mint the shared cookie — see the guard at the sign-in-mint branch
  // below (AGL-804).
  const restoredSilently = useRef(false)

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
            await mintSession(user, mintedForUid)
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
              if (active) {
                // The sign-out stands — a revoked session is deliberately
                // dead and only a real credential sign-in may follow. The
                // request is what turns the hard bounce to /signin into an
                // in-place prompt over the current route (AGL-664); it is
                // raised BEFORE signOut so the layout never sees a signed-
                // out beat without it and redirects anyway. Identity is
                // captured now, while there is still a user to ask.
                requestSessionReauth('revoked', captureReauthIdentity(user))
                await signOut(auth)
              }
              return
            }
            if (reason === 'signed-out') {
              const signedOutAt = Number(payload?.signedOutAt) || 0
              const lastSignInMs =
                Date.parse(user.metadata?.lastSignInTime ?? '') || 0
              if (tombstoneEndsSession(signedOutAt, lastSignInMs)) {
                if (active) {
                  // Same shape as `revoked` above (AGL-664).
                  requestSessionReauth(
                    'signed-out',
                    captureReauthIdentity(user),
                  )
                  await signOut(auth)
                }
                return
              }
            }
            await mintSession(user, mintedForUid)
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
          // …UNLESS this "sign-in" is actually the silent custom-token restore
          // we just performed from a still-valid shared cookie (AGL-804). That
          // cookie is the source of truth we restored FROM, so re-minting here
          // only writes a competing fresh cookie — and when the restoring tab
          // lives in its own storage partition (an automation browser, a
          // different subdomain), that fresh mint strands the tab that minted
          // the original. A silent restore adopts the session; it never mints.
          if (restoredSilently.current) {
            restoredSilently.current = false
            return
          }
          await mintSession(user, mintedForUid)
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
          // …and take the service worker's caches with it (AGL-1056), so
          // nothing this session stored survives into the next one on a
          // shared machine.
          //
          // HERE rather than at the sign-out buttons, because this is the one
          // place every intentional sign-out converges — the /signout page and
          // the staff impersonation exit both just mark the intent and let
          // this branch act on it. Wiring it at the call sites would be two
          // places to remember and a third to forget, and impersonation is
          // precisely the path where forgetting matters most.
          await clearServiceWorkerCaches()
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
            // Silent restore — the follow-up auth emission must NOT re-mint
            // the shared cookie (AGL-804).
            restoredSilently.current = true
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
          // Silent restore — the follow-up auth emission must NOT re-mint
          // the shared cookie (AGL-804).
          restoredSilently.current = true
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
