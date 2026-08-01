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

import {
  AppLink,
  LoadingTextComponent,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { useContinueUrl } from '@aglyn/shared-util-next'
import { Button, CircularProgress, Link, Stack, Typography } from '@mui/material'
import { applyActionCode } from 'firebase/auth'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth, useSigninCheck } from '@aglyn/tenant-feature-instance'
import AuthFormComponent from '../../../components/auth-form.component'

// How often we silently re-check verification while the user is on this page —
// so clicking the emailed link in another tab lets them straight through here
// without a manual refresh.
const POLL_MS = 4000

function VerifyEmail() {
  const firebaseAuth = useAuth()
  const router = useRouter()
  const { queueLoading, loading } = useLoading()
  const { status, data: signInCheckResult } = useSigninCheck()
  const authLoading = status === 'loading'
  const signedIn = signInCheckResult?.signedIn === true
  const email = signInCheckResult?.user?.email ?? firebaseAuth.currentUser?.email
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentOnceRef = useRef(false)

  // Land the user in the app the moment their email is verified. A hard
  // navigation (not client push) re-initialises auth so the gate re-reads a
  // fresh, verified ID token instead of a cached signed-in-check result.
  const goToApp = useCallback(async () => {
    const user = firebaseAuth.currentUser
    if (!user) return
    await user.getIdToken(true).catch(() => undefined)
    if (typeof window !== 'undefined') window.location.assign('/')
  }, [firebaseAuth])

  const sendLink = useCallback(async () => {
    const user = firebaseAuth.currentUser
    if (!user || loading) return
    setError(null)
    const dequeueLoading = queueLoading()
    try {
      // Aglyn sends this now, not Firebase (AGL-1112) — same reason as the
      // reset mail: the Firebase template is locked, so its subject still
      // carries `[aglyn.io]` and its link lands on a firebaseapp.com host.
      // The one-time code is still minted by Firebase.
      const idToken = await user.getIdToken()
      const response = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        alreadyVerified?: boolean
      }
      if (response.status === 429) {
        setError('Too many requests — wait a moment before requesting another link.')
        return
      }
      if (!response.ok) {
        setError(payload.error ?? 'We couldn’t send the verification email. Try again shortly.')
        return
      }
      // Verified in another tab while this page sat open. Sending a mail
      // whose link is already a no-op would read as the flow being stuck.
      if (payload.alreadyVerified) {
        await goToApp()
        return
      }
      setSent(true)
    } catch (e: any) {
      console.error(e)
      setError('We couldn’t send the verification email. Try again shortly.')
    } finally {
      dequeueLoading()
    }
  }, [firebaseAuth, goToApp, loading, queueLoading])

  // Re-check verification: reload the user, and if verified, head to the app.
  const checkNow = useCallback(async () => {
    const user = firebaseAuth.currentUser
    if (!user) return
    await user.reload().catch(() => undefined)
    if (user.emailVerified) await goToApp()
  }, [firebaseAuth, goToApp])

  // Redeem the code from the emailed link (AGL-1112).
  //
  // Aglyn's own link points here directly instead of at Firebase's
  // `/__/auth/action` handler, so this page has to do what that handler used
  // to: apply the code. Nothing did before, because the link never arrived
  // here — it arrived at firebaseapp.com, which applied it and redirected.
  //
  // Runs BEFORE the signed-out redirect below, and does not require a
  // session: people open verification links in whatever browser their mail
  // client hands them, frequently not the one they signed up in. Bouncing
  // them to /signin without applying the code would waste the code and leave
  // the account unverified.
  const [applying, setApplying] = useState(() =>
    typeof window !== 'undefined'
      ? Boolean(new URLSearchParams(window.location.search).get('oobCode'))
      : false,
  )
  useEffect(() => {
    if (!applying) return
    const oobCode = new URLSearchParams(window.location.search).get('oobCode')
    if (!oobCode) {
      setApplying(false)
      return
    }
    void (async () => {
      try {
        await applyActionCode(firebaseAuth, oobCode)
        const user = firebaseAuth.currentUser
        if (user) {
          // Refresh so `email_verified` is true on the next token the gate
          // reads; without this the app bounces straight back here.
          await user.reload().catch(() => undefined)
          await goToApp()
          return
        }
        router.replace('/signin?verified=1')
      } catch {
        // Expired, already used, or malformed. Not fatal: the page below
        // offers to send another, which is the only useful next step.
        setError(
          'That verification link has expired or was already used. ' +
            'Send yourself a new one below.',
        )
      } finally {
        setApplying(false)
      }
    })()
  }, [applying, firebaseAuth, goToApp, router])

  // Signed out (or session lost) — nothing to verify here. Held off while a
  // code is being applied, so an out-of-browser click is not redirected away
  // mid-redemption.
  useEffect(() => {
    if (applying) return
    if (!authLoading && !signedIn) router.replace('/signin')
  }, [applying, authLoading, signedIn, router])

  // Already verified (e.g. an OAuth account that shouldn't be here, or a link
  // clicked before this mounted) — the layout will route away; nudge it.
  useEffect(() => {
    if (signInCheckResult?.user?.emailVerified) void goToApp()
  }, [signInCheckResult, goToApp])

  // Auto-send one link on first mount for a signed-in unverified user, then
  // poll for verification. Guarded so re-mounts / a returning tab don't spam.
  useEffect(() => {
    if (applying || authLoading || !signedIn) return
    if (!sentOnceRef.current) {
      sentOnceRef.current = true
      void sendLink()
    }
    const timer = setInterval(() => void checkNow(), POLL_MS)
    return () => clearInterval(timer)
  }, [applying, authLoading, signedIn, sendLink, checkNow])

  if (authLoading || !signedIn || signInCheckResult?.user?.emailVerified) {
    return (
      <AuthFormComponent
        headingTop={'One moment'}
        headingBottom={'Checking your account'}
        headingBottomProps={{ sx: { pb: 4 }, component: LoadingTextComponent }}
        headingAfter={<CircularProgress color="secondary" />}
      />
    )
  }

  return (
    <AuthFormComponent
      headingTop={'Verify your email'}
      headingBottom={
        <>
          {'We sent a verification link to '}
          <b>{email ?? 'your email address'}</b>
          {'. Open it to activate your account — this page updates on its own'}
          {' once you do.'}
        </>
      }
      paperAfter={
        <Typography component="div" variant="body2">
          {'Wrong account? '}
          <AppLink href="/signout">{'Sign out'}</AppLink>
        </Typography>
      }
    >
      <Stack spacing={1.5} sx={{ mt: 2, alignItems: 'stretch' }}>
        <Button variant="contained" color="secondary" onClick={() => void checkNow()}>
          {'I’ve verified — continue'}
        </Button>
        <Typography component="div" variant="body2" sx={{ textAlign: 'center' }}>
          {sent ? 'Didn’t get it? ' : ''}
          <Link
            component="button"
            type="button"
            variant="body2"
            onClick={() => void sendLink()}
            disabled={loading}
          >
            {'Resend verification email'}
          </Link>
        </Typography>
        {error ? (
          <Typography color="error" variant="body2" sx={{ textAlign: 'center' }}>
            {error}
          </Typography>
        ) : null}
      </Stack>
    </AuthFormComponent>
  )
}
VerifyEmail.displayName = 'Page:VerifyEmail'

export default VerifyEmail
