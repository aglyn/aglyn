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

import { useContinueUrlDecoded } from '@aglyn/shared-util-next'
import { signInWithCustomToken } from 'firebase/auth'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth, useSigninCheck } from '@aglyn/tenant-feature-instance'
import {
  buildDelegatedSignInUrl,
  clearDelegationBounces,
  recordDelegationBounce,
  shouldDelegateSignIn,
} from '../utils/auth-delegation'

/**
 * Workspace-subdomain sign-in delegation (AGL-465). On an org subdomain,
 * interactive OAuth can't run (unauthorizable/unframeable dynamic host),
 * so hand sign-in to the auth host and let the shared `__session` cookie
 * bring the session back. Returns `true` while this host delegates — the
 * caller suppresses the local form and OAuth so no auth iframe is framed.
 *
 * Only session-less loads bounce: if the shared cookie already exists,
 * `useSessionCookie`'s silent sign-in signs the user in here instead, so
 * this defers rather than redirecting.
 */
export type WorkspaceDelegationState = 'off' | 'redirecting' | 'stopped'

export function useDelegateWorkspaceSignIn(
  page: 'signin' | 'signup',
): WorkspaceDelegationState {
  const auth = useAuth()
  const { status, data: signInCheckResult } = useSigninCheck()
  const [next] = useContinueUrlDecoded()
  const started = useRef(false)
  const [stopped, setStopped] = useState(false)

  const delegating = useMemo(
    () =>
      typeof window !== 'undefined' &&
      shouldDelegateSignIn(window.location.host),
    [],
  )

  useEffect(() => {
    if (!delegating || status === 'loading') return
    if (signInCheckResult?.signedIn) {
      clearDelegationBounces() // signed in — the round-trip succeeded
      return // layout routes to the continue URL
    }
    if (started.current) return
    started.current = true
    let active = true
    void (async () => {
      // Establish the session from the shared cookie OURSELVES rather than
      // leaning on useSessionCookie's one-shot silent sign-in, which bails
      // on the first 401 and never retries — on a delegated return the
      // cookie can land a beat late, so that one-shot misses it and the
      // splash hangs forever (AGL-467). Retry briefly, and when the exchange
      // yields a token, sign in directly.
      for (let attempt = 0; active && attempt < 6; attempt++) {
        try {
          const response = await fetch('/api/auth/session')
          if (response.ok) {
            const payload = await response.json().catch(() => null)
            if (payload?.token && active && !auth.currentUser) {
              try {
                await signInWithCustomToken(auth, payload.token)
              } catch (error) {
                console.error(
                  '[auth] workspace custom-token sign-in failed',
                  error,
                )
              }
            }
            clearDelegationBounces()
            return // signedIn flips → layout routes
          }
          const payload = await response.json().catch(() => null)
          // Absent cookies can still be propagating after the hand-off;
          // anything else (signed-out tombstone, invalid) won't heal by
          // waiting — go delegate now.
          if (payload?.reason !== 'absent') break
        } catch {
          // network hiccup — retry
        }
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
      if (!active) return
      // Circuit breaker: if we keep coming back still session-less, stop and
      // surface an error rather than loop or hang on the spinner forever.
      if (!recordDelegationBounce()) {
        console.error(
          '[auth] workspace sign-in delegation bounced repeatedly without a ' +
            'session — stopping to avoid a redirect loop.',
        )
        setStopped(true)
        return
      }
      const returnPath = next || '/'
      window.location.assign(
        buildDelegatedSignInUrl(window.location.origin, returnPath, page),
      )
    })()
    return () => {
      active = false
    }
  }, [auth, delegating, status, signInCheckResult, next, page])

  if (!delegating) return 'off'
  return stopped ? 'stopped' : 'redirecting'
}

export default useDelegateWorkspaceSignIn
