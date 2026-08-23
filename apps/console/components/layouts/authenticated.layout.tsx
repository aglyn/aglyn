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

import { useLoading } from '@aglyn/shared-ui-jsx'
import { SplashScreen } from '@aglyn/shared-ui-jsx/components/splash-screen'
import { continueParam, useContinueUrl } from '@aglyn/shared-util-next'
import { useRouter } from 'next/navigation'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useSigninCheck } from '@aglyn/tenant-feature-instance'
import useIdleLogout from '../../hooks/use-idle-logout'
import {
  getSessionReauth,
  requestSessionReauth,
  subscribeSessionReauth,
  type SessionReauthState,
} from '../../utils/session-reauth'
import { recordSignInBounce } from '../../utils/signin-bounce'
import ImpersonationBanner from '../impersonation-banner.component'
import SessionHealthBanner from '../session-health-banner.component'
import SessionReauthDialog from '../session-reauth-dialog.component'

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

  // In-place re-auth (AGL-664): while a session-loss prompt is pending —
  // shown or dismissed into the degraded state — the layout must neither
  // redirect to /signin nor unmount the page, or the "resume exactly where
  // you were" promise is broken before the dialog can keep it. The store is
  // module state that resets on a page load, so a genuinely fresh
  // unauthenticated load (deep link, cleared storage) still redirects
  // exactly as before; only a session lost MID-USE holds here. Triggered
  // solely by the console's own auth-state signals — never by anything
  // read out of fetched content.
  const [reauth, setReauth] = useState<SessionReauthState>(getSessionReauth)
  useEffect(() => subscribeSessionReauth(setReauth), [])
  /** One app → `/signin` round trip is one MOUNT (AGL-2486). */
  const countedBounce = useRef(false)
  const bounceBudgetLeft = useRef(true)
  const reauthActive = reauth.reason !== null

  // Only meaningful while signed in: when a re-auth prompt is holding a
  // signed-out layout open, `emailVerified` is merely absent — that absence
  // must not answer the verification question and blank the page.
  const verifyBlocked = signedIn && gateOnVerify && impersonating !== true
  const invalidAuth =
    authLoading || (!signedIn && !reauthActive) || verifyBlocked
  // Idle session expiry (AGL-464) — armed only while signed in.
  useIdleLogout(signedIn)

  useEffect(() => {
    if (authLoading) return void 0
    if (!signedIn) {
      // Session lost mid-use with the re-auth dialog up (AGL-664): stay.
      if (reauthActive) return void 0
      // …and stop bouncing once this tab has made the round trip too many
      // times without settling (AGL-2486). `AuthenticatingLayout` pushes
      // back here the moment the session returns, so a session that flaps
      // makes these two layouts volley forever — which is what Zach saw on
      // production, with no way out of it from inside the app.
      //
      // The prompt this raises is NOT a softer outcome than the redirect it
      // replaces: `unstable` carries `requiresSignIn`, so the only way
      // forward is still a real credential sign-in. What changes is that
      // the user is told what happened instead of watching the URL
      // oscillate. Requested once per tab, not once per render, because
      // `reauthActive` is then true and this branch returns above.
      //
      // Counted at most once per MOUNT, which is the unit a round trip
      // actually has: this effect re-runs on any dep change (`next` moves
      // with the URL), and counting per run would let one stuck render
      // spend the whole budget without the user having been redirected
      // anywhere.
      if (!countedBounce.current) {
        countedBounce.current = true
        bounceBudgetLeft.current = recordSignInBounce()
      }
      if (!bounceBudgetLeft.current) {
        return void requestSessionReauth('unstable')
      }
      return void pushToRequestAuth(`/signin`)
    }
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
    reauthActive,
    router,
    signedIn,
  ])

  return (
    <Fragment>
      {!invalidAuth ? (
        <Fragment>
          {/* Impersonation warning (AGL-246). */}
          <ImpersonationBanner />
          {/* Stale-session watcher (AGL-1063, AGL-2486). Renders nothing
              until server reads fail across two distinct collections AND a
              public read proves it is this session — at which point it opens
              the dialog below rather than describing the problem in a
              banner. It still renders one for the App Check case, the one
              diagnosis signing in again cannot fix. Must stay ABOVE the
              dialog it drives. */}
          <SessionHealthBanner />
          {/* "Sign in again to verify your device" (AGL-664). Renders
              nothing until the console's own auth machinery requests it. */}
          <SessionReauthDialog />
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
