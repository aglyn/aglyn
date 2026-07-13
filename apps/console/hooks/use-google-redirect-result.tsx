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

import type { AuthResultError } from '@aglyn/shared-data-enums'
import { logEvent } from 'firebase/analytics'
import { getRedirectResult, GoogleAuthProvider } from 'firebase/auth'
import { useEffect, useRef } from 'react'
import { useAnalytics, useAuth } from '@aglyn/tenant-feature-instance'

/**
 * Completes a `signInWithRedirect` round-trip (AGL-462): mobile browsers
 * use the redirect OAuth flow, which lands back on the signin/signup page
 * with the result pending in `getRedirectResult`. Resolves it once on
 * mount — logging the analytics event the popup path logs inline, and
 * surfacing provider errors through the page's error alert. Resolves to
 * null (no-op) when no redirect is pending, so it is safe on every load.
 */
export function useGoogleRedirectResult(
  eventName: 'login' | 'sign_up',
  onError: (error: AuthResultError) => void,
  enabled = true,
): void {
  const auth = useAuth()
  const analytics = useAnalytics()
  const resolved = useRef(false)

  useEffect(() => {
    // Disabled on delegating hosts (AGL-465): getRedirectResult would frame
    // the auth iframe, which a workspace subdomain can't — it must delegate.
    if (!enabled) return
    if (resolved.current) return
    resolved.current = true
    let active = true
    void getRedirectResult(auth)
      .then((credential) => {
        if (!credential || !active) return
        // logEvent's overloads type each known event name individually,
        // so the union has to be narrowed before the call.
        if (eventName === 'login') {
          logEvent(analytics, 'login', { method: credential.providerId })
        } else {
          logEvent(analytics, 'sign_up', { method: credential.providerId })
        }
      })
      .catch((error) => {
        console.error(error)
        if (!active) return
        onError({
          ...error,
          credential: GoogleAuthProvider.credentialFromError(error),
        })
      })
    return () => {
      active = false
    }
  }, [analytics, auth, eventName, onError, enabled])
}

export default useGoogleRedirectResult
