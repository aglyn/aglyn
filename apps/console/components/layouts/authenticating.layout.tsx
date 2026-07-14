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

import {
  BackgroundImageComponent,
  type BackgroundImageComponentProps,
} from '@aglyn/shared-ui-jsx'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { continueParam, useContinueUrl } from '@aglyn/shared-util-next'
import { Stack } from '@mui/material'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuth, useSigninCheck } from '@aglyn/tenant-feature-instance'

export interface AuthenticatingLayoutProps
  extends Partial<BackgroundImageComponentProps> {
  requireEmailVerification?: boolean
  signingOut?: boolean
}

function AuthenticatingLayout(props: AuthenticatingLayoutProps) {
  const { children, sx, requireEmailVerification, signingOut, ...rest } = props
  const router = useRouter()
  const auth = useAuth()
  const { status, data: signInCheckResult } = useSigninCheck()
  const authLoading = status === 'loading'
  const signedIn = signInCheckResult?.signedIn === true
  const emailVerified = signInCheckResult?.user?.emailVerified
  const [, continueUrl, pushContinued] = useContinueUrl()

  useEffect(() => {
    if (authLoading) return void 0
    if (signedIn && signingOut) return void 0
    if (!signedIn && !signingOut) return void 0
    if (signingOut)
      // Forward the continue param so an idle-expired session resumes on
      // the page it left off after re-authenticating (AGL-464).
      return void router.push(
        continueUrl
          ? `/signin?${continueParam(encodeURIComponent(continueUrl))}`
          : '/signin',
      )
    if (requireEmailVerification && !emailVerified)
      return void router.push('/validate-email')

    // Delegated cross-origin return (AGL-465/466): the workspace subdomain
    // signs in silently from the shared __session cookie, so that cookie
    // MUST exist before we hand back — otherwise its check 401s and it
    // bounces the user to the auth host again: a redirect loop. Mint it and
    // AWAIT before the hard navigation, which would otherwise abort the
    // in-flight mint. A same-origin '/' return keeps the client-nav path
    // (no race — the mint stays in flight).
    if (/^https?:\/\//.test(continueUrl)) {
      let active = true
      void (async () => {
        // Use the live SDK user (auth.currentUser) — the most reliable
        // source of a fresh ID token; signInCheckResult.user can lag. Force
        // a token refresh, and confirm the mint returned before handing off
        // so the workspace's silent sign-in has a cookie to read (AGL-467).
        const user = auth.currentUser ?? signInCheckResult?.user ?? null
        if (!user) {
          // Signed-in but no user object yet — wait for the next tick
          // rather than hand off with no cookie.
          return
        }
        try {
          const idToken = await user.getIdToken(true)
          const response = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { Authorization: `Bearer ${idToken}` },
          })
          if (!response.ok) {
            console.error(
              '[auth] delegated mint failed before hand-off',
              response.status,
              await response.text().catch(() => ''),
            )
          }
        } catch (error) {
          console.error('[auth] delegated mint threw before hand-off', error)
        }
        if (active && typeof window !== 'undefined') {
          window.location.assign(continueUrl)
        }
      })()
      return () => {
        active = false
      }
    }

    return void pushContinued('/')
  }, [
    auth,
    authLoading,
    continueUrl,
    emailVerified,
    signingOut,
    pushContinued,
    requireEmailVerification,
    router,
    signedIn,
    signInCheckResult,
  ])

  return (
    <BackgroundImageComponent
      url="/_static/images/backgrounds/patterns/abstract-wave-lines.svg"
      sx={mergeSxProps(
        {
          minHeight: '100vh',
          bgcolor: 'background.default',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          p: { xs: 2, md: 3 },
          color: 'text.primary',
        },
        sx,
      )}
      {...rest}
    >
      <Stack
        direction="column"
        spacing={2}
        sx={{
          justifyContent: "center",
          alignItems: "center",
          maxWidth: 1,
          width: 440
        }}>
        {children}
      </Stack>
    </BackgroundImageComponent>
  );
}
AuthenticatingLayout.displayName = 'AuthenticatingLayout'
AuthenticatingLayout.aglyn = true

export { AuthenticatingLayout }
export default AuthenticatingLayout
