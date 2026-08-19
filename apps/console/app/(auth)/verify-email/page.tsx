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

// Deep import, not the `@aglyn/aglyn` barrel (AGL-2170): the barrel pulls
// shared-data-enums -> firebase-auth into every consumer's module graph, which
// breaks specs that mock firebase wholesale (AuthErrorCodes reads undefined).
// One brand string is not worth that edge.
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { AppLink, useLoading } from '@aglyn/shared-ui-jsx'
import { LoadingTextComponent } from '@aglyn/shared-ui-jsx/components/loading-text.component'
import {
  Button,
  CircularProgress,
  Link,
  Stack,
  Typography,
} from '@mui/material'
import { applyActionCode } from 'firebase/auth'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth, useSigninCheck } from '@aglyn/tenant-feature-instance'
import AuthFormComponent from '../../../components/auth-form.component'
import hardNavigate from '../../../utils/hard-navigate'

// How often we silently re-check verification while the user is on this page —
// so clicking the emailed link in another tab lets them straight through here
// without a manual refresh.
const POLL_MS = 4000

/**
 * The one-shot code's lifecycle on this page (AGL-1524).
 *
 * `pending` and `failed` both mean "this page is the redemption surface for a
 * code right now", and while either holds, NOTHING may navigate away:
 *
 * - `pending`: the apply call is in flight. `window.location.assign` (a hard
 *   navigation) aborts in-flight fetches, so any bounce that fires here can
 *   cancel the redemption before the request even leaves the browser — the
 *   click then LOOKS like it worked while the account stays unverified. That
 *   is exactly what happened to the first production signup: the link was
 *   opened in a browser holding a different, already-verified session, the
 *   "already verified" bounce won the race (the apply call additionally waits
 *   on App Check's reCAPTCHA token before it can send anything), and the code
 *   was never applied.
 * - `failed`: the error must stay on screen. Before this state existed, a
 *   signed-out click that failed was silently redirected to /signin and a
 *   verified-session click that failed was bounced into the app — both
 *   success-shaped exits from a failure.
 */
type ApplyState = 'pending' | 'failed' | null

function VerifyEmail() {
  const firebaseAuth = useAuth()
  const router = useRouter()
  const { queueLoading, loading } = useLoading()
  const { status, data: signInCheckResult } = useSigninCheck()
  const authLoading = status === 'loading'
  const signedIn = signInCheckResult?.signedIn === true
  const sessionVerified = signInCheckResult?.user?.emailVerified === true
  const email =
    signInCheckResult?.user?.email ?? firebaseAuth.currentUser?.email
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
    hardNavigate('/')
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
        setError(
          'Too many requests — wait a moment before requesting another link.',
        )
        return
      }
      if (!response.ok) {
        setError(
          payload.error ??
            'We couldn’t send the verification email. Try again shortly.',
        )
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
  // Runs BEFORE every redirect on this page, and does not require a session:
  // people open verification links in whatever browser their mail client
  // hands them, frequently not the one they signed up in. That browser may
  // hold no session, the new unverified session, or a DIFFERENT verified
  // session — in every one of those the code must be applied before anything
  // is allowed to navigate (AGL-1524; see `ApplyState`).
  const [applyState, setApplyState] = useState<ApplyState>(() =>
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('oobCode')
      ? 'pending'
      : null,
  )
  const applying = applyState === 'pending'
  useEffect(() => {
    if (!applying) return
    const oobCode = new URLSearchParams(window.location.search).get('oobCode')
    if (!oobCode) {
      setApplyState(null)
      return
    }
    void (async () => {
      try {
        await applyActionCode(firebaseAuth, oobCode)
        const user = firebaseAuth.currentUser
        if (user) {
          // Refresh so `email_verified` is true on the next token the gate
          // reads; without this the app bounces straight back here. When the
          // session belongs to a different (already verified) account, the
          // reload is a harmless no-op and the bounce below is correct.
          await user.reload().catch(() => undefined)
          await goToApp()
          return
        }
        router.replace('/signin?verified=1')
      } catch {
        // Expired, already used, or malformed. `failed` pins the error on
        // screen: the redirects below stay held so the person who clicked
        // actually SEES that the click did not verify anything (AGL-1524).
        setError(
          'That verification link has expired or was already used. ' +
            'Send yourself a new one below.',
        )
        setApplyState('failed')
      }
    })()
  }, [applying, firebaseAuth, goToApp, router])

  // Signed out (or session lost) — nothing to verify here. Held while a code
  // is pending (an out-of-browser click must not be redirected away
  // mid-redemption) AND after a failure (a silent bounce to /signin would
  // swallow the error the user needs to see) — AGL-1524.
  useEffect(() => {
    if (applyState !== null) return
    if (!authLoading && !signedIn) router.replace('/signin')
  }, [applyState, authLoading, signedIn, router])

  // Already verified (e.g. an OAuth account that shouldn't be here, or a link
  // clicked before this mounted) — the layout will route away; nudge it.
  //
  // NEVER while a code is on this page (AGL-1524): `goToApp` is a hard
  // navigation, and firing it because the BROWSER's session is verified
  // aborts the in-flight apply for whatever account the emailed code belongs
  // to. This is the exact bounce that ate the first production signup's
  // verification click.
  useEffect(() => {
    if (applyState !== null) return
    if (sessionVerified) void goToApp()
  }, [applyState, sessionVerified, goToApp])

  // Auto-send one link on first mount for a signed-in unverified user, then
  // poll for verification. Guarded so re-mounts / a returning tab don't spam.
  // Held while a code is being applied, and never for a verified session —
  // `sendLink` answers a verified caller with `alreadyVerified`, whose
  // `goToApp` is one more hard navigation that must not race the apply.
  useEffect(() => {
    if (applying || authLoading || !signedIn || sessionVerified) return
    if (!sentOnceRef.current) {
      sentOnceRef.current = true
      void sendLink()
    }
    const timer = setInterval(() => void checkNow(), POLL_MS)
    return () => clearInterval(timer)
  }, [applying, authLoading, signedIn, sessionVerified, sendLink, checkNow])

  if (applying) {
    return (
      <AuthFormComponent
        headingTop={'One moment'}
        headingBottom={'Verifying your email'}
        headingBottomProps={{ sx: { pb: 4 }, component: LoadingTextComponent }}
        headingAfter={<CircularProgress color="primary" />}
      />
    )
  }

  // A failed apply with no unverified session to fall through to: the normal
  // resend flow below needs a signed-in unverified user, so these two states
  // get their own terminal view instead of a silent redirect (AGL-1524).
  if (applyState === 'failed' && (!signedIn || sessionVerified)) {
    return (
      <AuthFormComponent
        headingTop={'Verify your email'}
        headingBottom={'That verification link didn’t work'}
        paperAfter={
          <Typography component="div" variant="body2">
            {sessionVerified ? (
              <Link
                component="button"
                type="button"
                onClick={() => void goToApp()}
              >
                {`Continue to ${PLATFORM_BRAND_NAME}`}
              </Link>
            ) : (
              <>
                {'Sign in to request a new one: '}
                <AppLink href="/signin">{'Sign in'}</AppLink>
              </>
            )}
          </Typography>
        }
      >
        <Typography
          color="error"
          variant="body2"
          sx={{ mt: 2, textAlign: 'center' }}
        >
          {error ?? 'That verification link has expired or was already used.'}
        </Typography>
        {sessionVerified ? (
          <Typography variant="body2" sx={{ mt: 1.5, textAlign: 'center' }}>
            {'This browser is signed in to an account that is already ' +
              'verified — the link may belong to a different account. Open ' +
              'it in the browser you signed up in, or sign in as that ' +
              'account first.'}
          </Typography>
        ) : null}
      </AuthFormComponent>
    )
  }

  if (authLoading || !signedIn || sessionVerified) {
    return (
      <AuthFormComponent
        headingTop={'One moment'}
        headingBottom={'Checking your account'}
        headingBottomProps={{ sx: { pb: 4 }, component: LoadingTextComponent }}
        headingAfter={<CircularProgress color="primary" />}
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
        <Button
          variant="contained"
          color="primary"
          onClick={() => void checkNow()}
        >
          {'I’ve verified — continue'}
        </Button>
        <Typography
          component="div"
          variant="body2"
          sx={{ textAlign: 'center' }}
        >
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
          <Typography
            color="error"
            variant="body2"
            sx={{ textAlign: 'center' }}
          >
            {error}
          </Typography>
        ) : null}
      </Stack>
    </AuthFormComponent>
  )
}
VerifyEmail.displayName = 'Page:VerifyEmail'

export default VerifyEmail
