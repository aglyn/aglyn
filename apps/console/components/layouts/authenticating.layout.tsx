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
import { useSigninCheck } from '@aglyn/tenant-feature-instance'

export interface AuthenticatingLayoutProps
  extends Partial<BackgroundImageComponentProps> {
  requireEmailVerification?: boolean
  signingOut?: boolean
}

function AuthenticatingLayout(props: AuthenticatingLayoutProps) {
  const { children, sx, requireEmailVerification, signingOut, ...rest } = props
  const router = useRouter()
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
        try {
          const user = signInCheckResult?.user
          if (user) {
            const idToken = await user.getIdToken()
            await fetch('/api/auth/session', {
              method: 'POST',
              headers: { Authorization: `Bearer ${idToken}` },
            })
          }
        } catch {
          // Even a failed mint must not strand the user on the auth host.
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
