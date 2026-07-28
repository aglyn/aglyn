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
import { sendEmailVerification } from 'firebase/auth'
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
      await sendEmailVerification(user, {
        url: `${window.location.origin}/verify-email`,
        handleCodeInApp: false,
      })
      setSent(true)
    } catch (e: any) {
      // Firebase rate-limits repeated sends; surface it rather than silently
      // leaving the user waiting for an email that won't arrive.
      setError(
        e?.code === 'auth/too-many-requests'
          ? 'Too many requests — wait a moment before requesting another link.'
          : 'We couldn’t send the verification email. Try again shortly.',
      )
    } finally {
      dequeueLoading()
    }
  }, [firebaseAuth, loading, queueLoading])

  // Re-check verification: reload the user, and if verified, head to the app.
  const checkNow = useCallback(async () => {
    const user = firebaseAuth.currentUser
    if (!user) return
    await user.reload().catch(() => undefined)
    if (user.emailVerified) await goToApp()
  }, [firebaseAuth, goToApp])

  // Signed out (or session lost) — nothing to verify here.
  useEffect(() => {
    if (!authLoading && !signedIn) router.replace('/signin')
  }, [authLoading, signedIn, router])

  // Already verified (e.g. an OAuth account that shouldn't be here, or a link
  // clicked before this mounted) — the layout will route away; nudge it.
  useEffect(() => {
    if (signInCheckResult?.user?.emailVerified) void goToApp()
  }, [signInCheckResult, goToApp])

  // Auto-send one link on first mount for a signed-in unverified user, then
  // poll for verification. Guarded so re-mounts / a returning tab don't spam.
  useEffect(() => {
    if (authLoading || !signedIn) return
    if (!sentOnceRef.current) {
      sentOnceRef.current = true
      void sendLink()
    }
    const timer = setInterval(() => void checkNow(), POLL_MS)
    return () => clearInterval(timer)
  }, [authLoading, signedIn, sendLink, checkNow])

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
