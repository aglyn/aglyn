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
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { signOut } from 'firebase/auth'
import { useEffect, useRef } from 'react'
import { tombstoneEndsSession } from '../app/api/auth/session/session-tombstone'
import {
  clearInteractiveSignIn,
  consumeInteractiveSignIn,
  consumeInteractiveSignOut,
} from '../utils/interactive-signin'
import clearServiceWorkerCaches from '../utils/clear-service-worker-caches'
import {
  emailGateWouldRefuse,
  type ClaimSource,
} from '../utils/email-verification-gate'
import {
  adoptRestoredPool,
  signInWithPooledCustomToken,
} from '../utils/pooled-custom-token'
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
 *
 * Exported for the cross-domain handoff (AGL-1902), which mints outside this
 * hook: its landing page has to AWAIT the mint before navigating, and D5's
 * whole lesson from AGL-466 is that a fire-and-forget mint racing a navigation
 * is the redirect loop. Callers with no ref of their own pass
 * `{ current: null }`.
 */
export async function mintSession(
  user: { uid: string; getIdToken: () => Promise<string> } & ClaimSource,
  mintedForUid: { current: string | null },
): Promise<boolean> {
  // An unverified session is refused (AGL-479), and the token says so before
  // the request is made — so on the sign-up path this warned, in the voice
  // reserved for a real refusal, about the most ordinary event the console
  // has (AGL-2691). The warning below has to keep meaning something.
  //
  // ⚑ This does forgo the tombstone clear the refusal path performs
  // server-side (AGL-1142), and that is safe HERE and only here: everything
  // a shared cookie unlocks sits behind the same gate that refuses the mint,
  // so a tombstone standing through the unverified window denies access the
  // account does not have. It heals the moment it starts to matter — the
  // verified user hard-navigates, the restore branch below reads
  // `401 signed-out`, `tombstoneEndsSession` finds it older than this
  // account's sign-in, and the re-mint replaces it. Do not extend this to a
  // refusal the token cannot predict; the AGL-1142 nine-day cookie was a
  // VERIFIED account locked out, which this path can no longer produce.
  if (await emailGateWouldRefuse(user)) {
    mintedForUid.current = null
    return false
  }
  try {
    const response = await authorizedFetch(user, '/api/auth/session', {
      method: 'POST',
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

/** A live local user, as much of one as these two paths read. */
type SessionUser = Parameters<typeof mintSession>[0] & {
  metadata?: { lastSignInTime?: string | null }
  providerData?: Array<{ providerId?: string | null; email?: string | null } | null>
}

/**
 * Validate the shared cookie against a live local session, and act on the
 * answer (AGL-236, AGL-624, AGL-664).
 *
 * Lifted out of the load-time branch so the focus re-check can run the same
 * verdict (AGL-3242) — the SAME verdict, deliberately, and that is the
 * property to preserve if this is ever touched again. Only an explicit
 * sign-out elsewhere (a tombstone newer than this session's sign-in) or a
 * revocation ends the session; an absent or expired cookie is ambiguous and
 * heals by re-minting. Because the conditions are unchanged, a re-checked tab
 * can only reach a conclusion a reloaded tab would already have reached.
 *
 * `isActive` is read after every await rather than passed as a boolean: the
 * caller's effect may have torn down while a request was in flight, and a
 * snapshot taken before the await cannot say so.
 */
async function validateSharedSession(
  auth: Parameters<typeof signOut>[0],
  user: SessionUser,
  mintedForUid: { current: string | null },
  isActive: () => boolean,
): Promise<void> {
  try {
    const response = await fetch('/api/auth/session')
    if (!isActive() || response.ok || response.status !== 401) return
    const payload = await response.json().catch(() => null)
    const reason = payload?.reason
    // A revocation always ends the session. A `signed-out` tombstone only
    // does when it is NEWER than this session's last sign-in — otherwise it
    // is stale (a prior sign-out whose re-login mint failed/raced) and would
    // otherwise log the user out on a plain refresh (AGL-624); heal it by
    // re-minting.
    if (reason === 'revoked') {
      if (isActive()) {
        // The sign-out stands — a revoked session is deliberately dead and
        // only a real credential sign-in may follow. The request is what
        // turns the hard bounce to /signin into an in-place prompt over the
        // current route (AGL-664); it is raised BEFORE signOut so the layout
        // never sees a signed-out beat without it and redirects anyway.
        // Identity is captured now, while there is still a user to ask.
        requestSessionReauth('revoked', captureReauthIdentity(user))
        await signOut(auth)
      }
      return
    }
    if (reason === 'signed-out') {
      const signedOutAt = Number(payload?.signedOutAt) || 0
      const lastSignInMs = Date.parse(user.metadata?.lastSignInTime ?? '') || 0
      if (tombstoneEndsSession(signedOutAt, lastSignInMs)) {
        if (isActive()) {
          // Same shape as `revoked` above (AGL-664).
          requestSessionReauth('signed-out', captureReauthIdentity(user))
          await signOut(auth)
        }
        return
      }
    }
    await mintSession(user, mintedForUid)
  } catch {
    // Network trouble never signs anyone out.
  }
}

/**
 * Sign this tab back in from the shared cookie, silently (AGL-543, AGL-1993).
 *
 * Also lifted out for the focus re-check (AGL-3242). It cannot resurrect a
 * session somebody ended: a genuine sign-out elsewhere leaves a tombstone and
 * the GET answers 401, which falls out at the `!response.ok` line without
 * touching auth. So the worst a spurious call can do is spend one request.
 */
async function restoreFromSharedCookie(
  auth: Parameters<typeof signInWithPooledCustomToken>[0],
  restoredSilently: { current: boolean },
  isActive: () => boolean,
): Promise<void> {
  try {
    const response = await fetch('/api/auth/session')
    if (!response.ok || !isActive()) return
    const payload = await response.json()
    if (payload?.token && isActive()) {
      // Silent restore — the follow-up auth emission must NOT re-mint the
      // shared cookie (AGL-804) — and must stay in the token's own pool
      // (AGL-1993). An SSO session's cookie is re-minted through the GCIP
      // tenant, so exchanging it on a project-pool instance is a cross-pool
      // exchange — the failure that hid a staff claim.
      restoredSilently.current = true
      await signInWithPooledCustomToken(auth, payload.token, payload.tenantId)
    }
  } catch {
    // Network trouble never signs anyone out; the next re-check or the next
    // load's restore branch gets another chance.
  }
}

/**
 * How often a tab may re-check its session on being brought forward
 * (AGL-3242).
 *
 * A real recovery lands on the FIRST focus, so this number never delays the
 * case it exists for; it only stops a person alt-tabbing between two consoles
 * from issuing a request per switch. Short enough that a second attempt after
 * a failed one is a beat away, not a wait.
 */
export const SESSION_RECHECK_THROTTLE_MS = 10_000

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
          // This user came out of PERSISTENCE (or a redirect landing), and a
          // restore leaves `auth.tenantId` at its constructed `null` however
          // tenanted the user is — the SDK's own invariant, un-asserted on
          // this one path (AGL-2486). Repair it before anything reads a
          // token or another tab writes the shared record, both of which
          // this instance would otherwise handle on the wrong pool. Safe
          // HERE and only here: `isInitialState` is the one moment no
          // sign-in is in flight on this tab.
          adoptRestoredPool(auth, user as { tenantId?: string | null })
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
          await validateSharedSession(
            auth,
            user as SessionUser,
            mintedForUid,
            () => active,
          )
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
        await restoreFromSharedCookie(auth, restoredSilently, () => active)
        return
      }
      if (restoreAttempted.current) return
      restoreAttempted.current = true
      // The branch a staff member signing in through SSO actually takes on a
      // cold load of app.aglyn.com.
      await restoreFromSharedCookie(auth, restoredSilently, () => active)
    })()
    return () => {
      active = false
    }
  }, [auth, user])

  /*==========================================
   * COMING BACK TO A TAB (AGL-3242)
   *
   * Everything above is load-time: the validate-or-restore verdict is reached
   * on the FIRST auth emission after a page load, and after that the tab only
   * moves when Firebase emits a new auth state. A tab whose session went bad
   * therefore had exactly one way back — a manual reload — and with several
   * consoles open that turned recovery into a race the reader ran by hand,
   * reloading every tab before any one of them could tombstone the session
   * again.
   *
   * Bringing a tab forward is the moment the reader is asking for it to work,
   * and it is free: the tab was idle. So re-run the same verdict here.
   *
   * ⛔ The verdict is the SAME one, and it has to stay that way. A focused tab
   * ends its session on exactly the two conditions a reloaded tab ends it on
   * — a revocation, or a tombstone newer than this session's sign-in — so
   * this can never sign anyone out that a refresh would not have. If a future
   * change makes `validateSharedSession` stricter, it gets stricter on both
   * paths at once, which is the point of there being one function.
   */
  const rechecking = useRef(false)
  const lastRecheckAt = useRef(0)

  useEffect(() => {
    if (FIREBASE_AUTH_EMULATOR_ENABLED) return undefined
    let active = true
    const recheck = () => {
      // `visibilitychange` fires on the way INTO hidden as well as out of it.
      if (document.visibilityState !== 'visible') return
      // Nothing to re-check before the load-time pass has run — and running
      // first would read a token before `adoptRestoredPool` has repaired the
      // instance's pool, which is the AGL-2486 trap.
      if (!sawInitialState.current) return
      if (rechecking.current) return
      const at = Date.now()
      if (at - lastRecheckAt.current < SESSION_RECHECK_THROTTLE_MS) return
      rechecking.current = true
      lastRecheckAt.current = at
      void (async () => {
        try {
          const current = auth.currentUser as SessionUser | null
          if (current) {
            await validateSharedSession(
              auth,
              current,
              mintedForUid,
              () => active,
            )
          } else {
            // No local user: this is the tab parked on `/signin` after a
            // sibling signed in, and the one the reader was reloading by
            // hand. A tombstone still answers 401 and falls straight out, so
            // a deliberate sign-out stays signed out.
            await restoreFromSharedCookie(auth, restoredSilently, () => active)
          }
        } finally {
          rechecking.current = false
        }
      })()
    }
    document.addEventListener('visibilitychange', recheck)
    // Coming back from a dropped connection is the other moment a session
    // that could not be validated can be (`use-is-staff` pairs the same two).
    window.addEventListener('online', recheck)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('online', recheck)
    }
  }, [auth])
}

export default useSessionCookie
