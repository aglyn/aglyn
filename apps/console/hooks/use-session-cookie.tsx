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
import { signInWithCustomToken } from 'firebase/auth'
import { useEffect, useRef } from 'react'

/**
 * Cross-subdomain session sync (AGL-236). Firebase client auth is
 * per-origin, so each {org}.aglyn.io workspace starts signed out even
 * when app.aglyn.io is authenticated. This hook keeps the parent-
 * domain `__session` cookie in step with client auth:
 *
 * - signed in  → mint/refresh the cookie (idempotent POST);
 * - signed out on load, cookie present → silent sign-in via the
 *   custom-token exchange;
 * - explicit sign-out (signed-in → signed-out transition) → clear the
 *   cookie so other subdomains sign out too on their next load.
 */
export function useSessionCookie(): void {
  const auth = useAuth()
  const { data: user } = useUser()
  const hadUser = useRef(false)
  const restoreAttempted = useRef(false)

  useEffect(() => {
    let active = true
    void (async () => {
      if (user) {
        hadUser.current = true
        try {
          const idToken = await user.getIdToken()
          await fetch('/api/auth/session', {
            method: 'POST',
            headers: { Authorization: `Bearer ${idToken}` },
          })
        } catch {
          // cookie mint is best-effort; the current origin stays signed in
        }
        return
      }
      if (hadUser.current) {
        // Explicit sign-out: retire the shared session.
        hadUser.current = false
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
