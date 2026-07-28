/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import { SplashScreen, useLoading } from '@aglyn/shared-ui-jsx'
import { continueParam, useContinueUrl } from '@aglyn/shared-util-next'
import { useRouter } from 'next/navigation'
import { Fragment, useEffect, useState } from 'react'
import { useSigninCheck } from '@aglyn/tenant-feature-instance'
import useIdleLogout from '../../hooks/use-idle-logout'
import ImpersonationBanner from '../impersonation-banner.component'
import SessionHealthBanner from '../session-health-banner.component'

export interface AuthenticatedLayoutProps {
  children?: JSX.Children
  requireEmailVerification?: boolean
}

function AuthenticatedLayout(props: AuthenticatedLayoutProps) {
  const { children, requireEmailVerification } = props
  const { queueLoading } = useLoading()
  const router = useRouter()
  const [next] = useContinueUrl()
  const { status, data: signInCheckResult } = useSigninCheck()
  const authLoading = status === 'loading'
  const signedIn = signInCheckResult?.signedIn === true
  const emailVerified = signInCheckResult?.user?.emailVerified
  const user = signInCheckResult?.user
  // Staff impersonation sessions (AGL-357) carry an `impersonatedBy` claim and
  // are exempt from the email-verify gate (AGL-480) — otherwise staff can't
  // reach a still-unverified owner. Only resolved when it could matter (signed
  // in but unverified); `null` = still reading the claim, so hold the splash
  // rather than redirect. Verified users never pay for the token read.
  const [impersonating, setImpersonating] = useState<boolean | null>(null)
  const gateOnVerify = requireEmailVerification && !emailVerified
  useEffect(() => {
    // Only read the claim when it could matter (gating + a user present).
    // Leave it `null` otherwise — never pre-set `false`, or the redirect below
    // could fire before the claim resolves and bounce an impersonation session.
    if (!gateOnVerify || !user) return void 0
    let active = true
    setImpersonating(null)
    void (
      user as {
        getIdTokenResult?: () => Promise<{ claims?: Record<string, unknown> }>
      }
    )
      .getIdTokenResult?.()
      .then((result) => {
        if (active) {
          setImpersonating(Boolean(result?.claims?.['impersonatedBy']))
        }
      })
      .catch(() => {
        // Fail closed: unreadable claim → treat as a normal session, gate applies.
        if (active) setImpersonating(false)
      })
    return () => void (active = false)
  }, [gateOnVerify, user])

  const verifyBlocked = gateOnVerify && impersonating !== true
  const invalidAuth = authLoading || !signedIn || verifyBlocked
  // Idle session expiry (AGL-464) — armed only while signed in.
  useIdleLogout(signedIn)

  useEffect(() => {
    if (authLoading) return void 0
    if (!signedIn) return void pushToRequestAuth(`/signin`)
    // Redirect only once the impersonation claim has resolved to false — while
    // it's unresolved (`null`) the splash holds and we must not bounce.
    if (gateOnVerify && impersonating === false)
      return void pushToRequestAuth(`/verify-email`)

    return void 0

    function pushToRequestAuth(path: string) {
      return void router.push(`${path}?${continueParam(next)}`)
    }
  }, [
    authLoading,
    next,
    gateOnVerify,
    impersonating,
    queueLoading,
    router,
    signedIn,
  ])

  return (
    <Fragment>
      {!invalidAuth ? (
        <Fragment>
          {/* Impersonation warning (AGL-246). */}
          <ImpersonationBanner />
          {/* "Your session needs refreshing" (AGL-1063). Renders nothing
              until server reads fail across two distinct collections. */}
          <SessionHealthBanner />
          {children}
        </Fragment>
      ) : (
        <SplashScreen />
      )}
    </Fragment>
  )
}
AuthenticatedLayout.displayName = 'AuthenticatedLayout'
AuthenticatedLayout.aglyn = true

export { AuthenticatedLayout }
export default AuthenticatedLayout
