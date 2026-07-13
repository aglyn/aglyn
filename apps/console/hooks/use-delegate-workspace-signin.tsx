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
import { useEffect, useMemo, useRef } from 'react'
import { useSigninCheck } from '@aglyn/tenant-feature-instance'
import {
  buildDelegatedSignInUrl,
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
export function useDelegateWorkspaceSignIn(
  page: 'signin' | 'signup',
): boolean {
  const { status, data: signInCheckResult } = useSigninCheck()
  const [next] = useContinueUrlDecoded()
  const started = useRef(false)

  const delegating = useMemo(
    () =>
      typeof window !== 'undefined' &&
      shouldDelegateSignIn(window.location.host),
    [],
  )

  useEffect(() => {
    if (!delegating || status === 'loading') return
    if (signInCheckResult?.signedIn) return // silent sign-in won — layout routes
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        // A live shared session means silent sign-in will land here; don't
        // bounce the user out to the auth host for nothing.
        const response = await fetch('/api/auth/session')
        if (response.ok) return
      } catch {
        // No reachable session — fall through and delegate.
      }
      const returnPath = next || '/'
      window.location.assign(
        buildDelegatedSignInUrl(window.location.origin, returnPath, page),
      )
    })()
  }, [delegating, status, signInCheckResult, next, page])

  return delegating
}

export default useDelegateWorkspaceSignIn
