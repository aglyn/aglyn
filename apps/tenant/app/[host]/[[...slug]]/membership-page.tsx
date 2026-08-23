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

import { safeSameOriginPath } from '@aglyn/shared-util-http/safe-redirect'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'

/**
 * Post-auth redirect target (AGL-553): only same-origin relative paths reach
 * a navigation here.
 *
 * This was a fourth hand-written copy of the same guard, with the same
 * incomplete character list every copy had (AGL-1881) — `/<TAB>/evil.com`
 * contains neither `//` nor `\` and the URL parser still resolves it off-site.
 * It now defers to the shared predicate, which resolves the value and compares
 * origins instead.
 */
function safeContinuePath(raw: string | null): string {
  return safeSameOriginPath(raw, '/')
}

export interface MembershipPageProps {
  /** 'signin' | 'signup' | 'recover' (AGL-109/552). */
  page: string
  hostId?: string
}

/**
 * Built-in membership surfaces (AGL-109/552), restyled for AGL-553: when a
 * host designates no auth screens, /signin /signup /recover render these
 * forms wrapped in the site theme (the `[host]` layout's HostThemeProvider
 * supplies palette + typography; this component paints the themed
 * background). Hosts that want full control design real screens and
 * assign them in Setup — this is only the fallback.
 */
export function MembershipPage({ page, hostId }: MembershipPageProps) {
  const isSignup = page === 'signup'
  const isRecover = page === 'recover'
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Recovery flow state (AGL-552): the emailed token arrives as a query
  // param, read post-hydration (unavailable during SSR).
  const [recoverToken, setRecoverToken] = useState('')
  const [recoverDone, setRecoverDone] = useState<
    'requested' | 'reset' | null
  >(null)
  useEffect(() => {
    if (!isRecover) return
    setRecoverToken(
      new URLSearchParams(window.location.search).get('token') ?? '',
    )
  }, [isRecover])

  const heading = isRecover
    ? 'Reset your password'
    : isSignup
      ? 'Create your account'
      : 'Welcome back'

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData(event.currentTarget)
      if (isRecover) {
        const isReset = Boolean(recoverToken)
        const response = await fetch(
          isReset ? '/api/membership/reset' : '/api/membership/recover',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hostId,
              ...(isReset
                ? {
                    token: recoverToken,
                    password: String(form.get('password') ?? ''),
                  }
                : { email: String(form.get('email') ?? '') }),
            }),
          },
        )
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          return setError(payload?.error ?? 'Something went wrong')
        }
        return setRecoverDone(isReset ? 'reset' : 'requested')
      }
      const response = await fetch(
        isSignup ? '/api/membership/register' : '/api/membership/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostId,
            email: String(form.get('email') ?? ''),
            password: String(form.get('password') ?? ''),
            ...(isSignup
              ? { displayName: String(form.get('displayName') ?? '') }
              : {}),
          }),
        },
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        return setError(
          payload?.error ?? (isSignup ? 'Sign-up failed' : 'Sign-in failed'),
        )
      }
      // Gated pages send visitors here with ?continue=; relative-only.
      window.location.assign(
        safeContinuePath(
          new URLSearchParams(window.location.search).get('continue'),
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        color: 'text.primary',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 420, mt: '15vh', px: 3, pb: 6 }}>
        <Typography variant="h5" component="h1" gutterBottom>
          {heading}
        </Typography>
        {isRecover && recoverDone === 'reset' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Alert severity="success">
              {'Your password has been updated.'}
            </Alert>
            <Button
              variant="contained"
              color="primary"
              href="/signin"
              sx={{ alignSelf: 'flex-start' }}
            >
              {'Sign in'}
            </Button>
          </Box>
        ) : isRecover && recoverDone === 'requested' ? (
          <Alert severity="success">
            {'If that email belongs to an account here, a reset link is on ' +
              'its way. The link works once and expires in an hour.'}
          </Alert>
        ) : (
          <Box
            component="form"
            onSubmit={submit}
            sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
          >
            {isRecover && !recoverToken ? (
              <Typography variant="body2" color="text.secondary">
                {'Enter your account email and we will send you a reset ' +
                  'link.'}
              </Typography>
            ) : null}
            {isSignup ? (
              <TextField name="displayName" label="Name" size="small" />
            ) : null}
            {!isRecover || !recoverToken ? (
              <TextField
                name="email"
                type="email"
                label="Email"
                required
                size="small"
              />
            ) : null}
            {!isRecover || recoverToken ? (
              <TextField
                name="password"
                type="password"
                label={recoverToken ? 'New password' : 'Password'}
                required
                size="small"
                slotProps={{
                  htmlInput: {
                    minLength: isSignup || recoverToken ? 8 : undefined,
                  },
                }}
                helperText={
                  isSignup || recoverToken ? 'At least 8 characters' : undefined
                }
              />
            ) : null}
            {error ? <Alert severity="error">{error}</Alert> : null}
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={busy}
              sx={{ alignSelf: 'flex-start' }}
            >
              {busy
                ? 'Working…'
                : isRecover
                  ? recoverToken
                    ? 'Set new password'
                    : 'Email me a reset link'
                  : isSignup
                    ? 'Sign up'
                    : 'Sign in'}
            </Button>
          </Box>
        )}
        <Typography variant="body2" sx={{ mt: 2, opacity: 0.9 }}>
          {isRecover ? (
            <Link href="/signin" underline="hover">
              {'Back to sign in'}
            </Link>
          ) : isSignup ? (
            <Link href="/signin" underline="hover">
              {'Already a member? Sign in'}
            </Link>
          ) : (
            <>
              <Link href="/signup" underline="hover">
                {'New here? Create an account'}
              </Link>
              {' · '}
              {/* Recovery flow (AGL-552). */}
              <Link href="/recover" underline="hover">
                {'Forgot password?'}
              </Link>
            </>
          )}
        </Typography>
      </Box>
    </Box>
  )
}

export default MembershipPage
