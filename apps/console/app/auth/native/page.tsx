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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { LoadingTextComponent } from '@aglyn/shared-ui-jsx/components/loading-text.component'
import { fbClientAppOptions, useAuth, useSigninCheck } from '@aglyn/tenant-feature-instance'
import { Button, CircularProgress, Stack, Typography } from '@mui/material'
import { signOut } from 'firebase/auth'
import { useCallback, useEffect, useMemo, useState } from 'react'
import AuthFormComponent from '../../../components/auth-form.component'
import { markInteractiveSignOut } from '../../../utils/interactive-signin'
import { nativeHandoffAuthOrigin } from '../../../utils/native-handoff-origin'

/**
 * `/auth/native` — the console page the native apps open to sign in through
 * the console (AGL-3816): workspace single sign-on on every app, and every
 * sign-in and sign-up on the Windows build. The app opens it in the platform's
 * auth session (or the system browser) with a PKCE challenge, the return
 * address and its `state`.
 *
 * Signed out, it sends the visitor to the console's own `/signin`, `/signup`
 * or `/sso` (`start` picks which) with this page as the `continue`, so every
 * rule of those pages applies unchanged. Signed in, it says who is signed in
 * and asks before handing that account to the app, because a sign-in already
 * in this browser must never be handed over silently (AGL-1415); "Use a
 * different account" signs the browser out instead. Continuing asks
 * `/api/auth/native-handoff/authorize` for a one-time code and goes to the
 * app's return address with it.
 */

type Phase = 'checking' | 'ready' | 'unverified' | 'working' | 'returned' | 'failed'

const START_PAGES: Record<string, string> = {
  signin: '/signin',
  signup: '/signup',
  sso: '/sso',
}

function NativeHandoff() {
  const auth = useAuth()
  const { status, data: signInCheckResult } = useSigninCheck()
  const signedIn = signInCheckResult?.signedIn === true
  const user = signInCheckResult?.user ?? null
  const [phase, setPhase] = useState<Phase>('checking')
  const [error, setError] = useState<string | null>(null)

  const params = useMemo(
    () => new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search),
    [],
  )
  // The whole hand-off runs on the Firebase auth origin, or the sign-in sheet never sees an SSO result (AGL-3836).
  const authOrigin = useMemo(
    () => (typeof window === 'undefined' ? null : nativeHandoffAuthOrigin(window.location, fbClientAppOptions.authDomain)),
    [],
  )
  const here = useMemo(() => {
    if (typeof window === 'undefined') return '/auth/native'
    const carried = new URLSearchParams(window.location.search)
    // `start` is spent once the visitor has been sent to sign in.
    carried.delete('start')
    return `/auth/native?${carried.toString()}`
  }, [])

  const sendTo = useCallback(
    (page: string) => {
      // The address the app already has (an SSO domain it looked up) rides to `/sso`, so it is not asked for twice.
      const hint = page === '/sso' ? params.get('login_hint') : null
      window.location.assign(
        `${page}?continue=${encodeURIComponent(here)}` +
          (hint ? `&email=${encodeURIComponent(hint)}` : ''),
      )
    },
    [here, params],
  )

  useEffect(() => {
    if (authOrigin) {
      window.location.replace(authOrigin)
      return
    }
    if (status === 'loading') return
    if (!signedIn) {
      const start = START_PAGES[params.get('start') ?? '']
      if (start) {
        sendTo(start)
        return
      }
      setPhase('ready')
      return
    }
    setPhase(user?.emailVerified ? 'ready' : 'unverified')
  }, [authOrigin, params, sendTo, signedIn, status, user?.emailVerified])

  const handOff = useCallback(async () => {
    const current = auth.currentUser
    if (!current) return
    setPhase('working')
    setError(null)
    try {
      const response = await authorizedFetch(current, '/api/auth/native-handoff/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge: params.get('challenge'),
          redirectUri: params.get('redirect_uri'),
          state: params.get('state'),
        }),
      })
      const payload = (await response.json().catch(() => null)) as {
        url?: string
        error?: string
        reason?: string
      } | null
      if (!response.ok || !payload?.url) {
        if (payload?.reason === 'email-unverified') {
          setPhase('unverified')
          return
        }
        setError(payload?.error ?? 'Signing in to the app failed. Try again from the app.')
        setPhase('failed')
        return
      }
      setPhase('returned')
      window.location.assign(payload.url)
    } catch (caught) {
      console.error('[auth/native] hand-off failed', caught)
      setError('Signing in to the app failed. Try again from the app.')
      setPhase('failed')
    }
  }, [auth, params])

  const switchAccount = useCallback(async () => {
    markInteractiveSignOut()
    await signOut(auth).catch(() => undefined)
    setPhase('ready')
  }, [auth])

  if (phase === 'checking' || phase === 'working') {
    return (
      <AuthFormComponent
        headingTop={'One moment'}
        headingBottom={'Checking your account'}
        headingBottomProps={{ sx: { pb: 4 }, component: LoadingTextComponent }}
        headingAfter={<CircularProgress color="primary" />}
      />
    )
  }

  if (phase === 'returned') {
    return (
      <AuthFormComponent
        headingTop={`Back to the ${PLATFORM_BRAND_NAME} app`}
        headingBottom={'You are signed in. If the app did not open, return to it to finish.'}
      />
    )
  }

  if (phase === 'unverified') {
    return (
      <AuthFormComponent
        headingTop={'Verify your email'}
        headingBottom={'Confirm your email address first, then come back to continue in the app.'}
      >
        <Stack spacing={1.5} sx={{ mt: 2, alignItems: 'stretch' }}>
          <Button variant="contained" onClick={() => sendTo('/verify-email')}>
            {'Verify your email'}
          </Button>
          <Button variant="text" onClick={() => void switchAccount()}>
            {'Use a different account'}
          </Button>
        </Stack>
      </AuthFormComponent>
    )
  }

  if (!signedIn) {
    return (
      <AuthFormComponent
        headingTop={`Sign in to the ${PLATFORM_BRAND_NAME} app`}
        headingBottom={'Sign in or create your account here, and the app picks it up.'}
      >
        <Stack spacing={1.5} sx={{ mt: 2, alignItems: 'stretch' }}>
          <Button variant="contained" onClick={() => sendTo('/signin')}>
            {'Sign in'}
          </Button>
          <Button variant="outlined" onClick={() => sendTo('/signup')}>
            {'Create account'}
          </Button>
          <Button variant="outlined" onClick={() => sendTo('/sso')}>
            {'Single sign-on (SSO)'}
          </Button>
        </Stack>
      </AuthFormComponent>
    )
  }

  return (
    <AuthFormComponent
      headingTop={`Continue in the ${PLATFORM_BRAND_NAME} app`}
      headingBottom={
        <>
          {'Signed in as '}
          <b>{user?.email ?? 'your account'}</b>
          {'. Continue to sign the app in with this account.'}
        </>
      }
    >
      <Stack spacing={1.5} sx={{ mt: 2, alignItems: 'stretch' }}>
        <Button variant="contained" onClick={() => void handOff()}>
          {'Continue in the app'}
        </Button>
        <Button variant="text" onClick={() => void switchAccount()}>
          {'Use a different account'}
        </Button>
        {phase === 'failed' && error ? (
          <Typography color="error" variant="body2" sx={{ textAlign: 'center' }}>
            {error}
          </Typography>
        ) : null}
      </Stack>
    </AuthFormComponent>
  )
}

NativeHandoff.displayName = 'Page:NativeHandoff'

export default NativeHandoff
