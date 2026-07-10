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

import { useAuth, useUser } from '@aglyn/tenant-feature-instance'
import { signInWithCustomToken, signOut } from 'firebase/auth'
import { useEffect, useRef } from 'react'

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
 * - explicit sign-out → clear the cookie (the signout page also clears
 *   it before signOut so a hard navigation can't strand it).
 */
export function useSessionCookie(): void {
  const auth = useAuth()
  const { data: user } = useUser()
  const hadUser = useRef(false)
  const sawInitialState = useRef(false)
  const mintedForUid = useRef<string | null>(null)
  const restoreAttempted = useRef(false)

  useEffect(() => {
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
          // Restored from this origin's persistence — defer to the
          // shared cookie. Gone/invalid ⇒ signed out elsewhere.
          try {
            const response = await fetch('/api/auth/session')
            if (active && response.status === 401) {
              await signOut(auth)
            }
          } catch {
            // Network trouble never signs anyone out.
          }
          return
        }
        if (!wasSignedIn && mintedForUid.current !== user.uid) {
          // Interactive sign-in on this origin → share the session.
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
        // Explicit sign-out: retire the shared session.
        hadUser.current = false
        mintedForUid.current = null
        await fetch('/api/auth/session', { method: 'DELETE' }).catch(
          () => undefined,
        )
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
