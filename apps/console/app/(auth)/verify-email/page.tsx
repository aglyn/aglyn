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
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { useContinueUrlDecoded } from '@aglyn/shared-util-next'
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
import {
  authorizedFetch,
  resolveIdToken,
} from '@aglyn/shared-util-http/authorized-token'
import AuthFormComponent from '../../../components/auth-form.component'
import hardNavigate from '../../../utils/hard-navigate'
import { verifiedContinueTarget } from '../../../utils/verified-continue-target'

// How often we silently re-check verification while the user is on this page —
// so clicking the emailed link in another tab lets them straight through here
// without a manual refresh.
const POLL_MS = 4000

/**
 * Same-browser hand-off from the tab that redeemed the link to the tab still
 * waiting on this page (AGL-3384). The waiting tab otherwise learns about the
 * verification only from its poll — and a backgrounded tab's timers are
 * suspended (iOS Safari suspends them outright), so the tab the person
 * returns to could sit on "we sent a link" until the next tick lands.
 */
const VERIFIED_CHANNEL = 'aglyn:email-verified'

/** Tell every other tab in this browser that a code was just redeemed. */
function announceVerified(): void {
  if (typeof BroadcastChannel === 'undefined') return
  try {
    const channel = new BroadcastChannel(VERIFIED_CHANNEL)
    channel.postMessage('verified')
    channel.close()
  } catch {
    // A browser without the API still has the poll and the focus re-check.
  }
}

/**
 * The one-shot code's lifecycle on this page (AGL-1524).
 *
 * `pending`, `applied` and `failed` all mean "this page is the redemption
 * surface for a code right now", and while any holds, NOTHING may navigate
 * away on its own:
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
 * - `applied`: the code worked, and the page says so (AGL-3384). A mail client
 *   opened this tab, and the tab the person signed up in is usually still
 *   open and carries on by itself. So the success page lets them close this
 *   one and moves on only when asked. Navigating away at once, or to a bare
 *   /signin when this browser had no session, read as "it went nowhere".
 */
type ApplyState = 'pending' | 'applied' | 'failed' | null

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
  // Verified and on the way into the app: the navigation is a token refresh
  // plus a full page load, and the page says what is happening meanwhile.
  const [continuing, setContinuing] = useState(false)
  const sentOnceRef = useRef(false)
  const checkingRef = useRef(false)

  // Where the layout sent them from (AGL-1730). Every exit from this page
  // used to hard-navigate to `/`, so a deep link that hit the verification
  // wall — a billing page, an invite, a plugin's settings — was thrown away
  // the moment the account became usable. `useContinueUrlDecoded` already
  // drops anything that isn't a same-app or same-site URL; the target helper
  // additionally refuses the auth routes, which as a destination are a loop.
  const [continueUrl] = useContinueUrlDecoded()

  // Land the user in the app the moment their email is verified. A hard
  // navigation (not client push) re-initialises auth so the gate re-reads a
  // fresh, verified ID token instead of a cached signed-in-check result.
  const goToApp = useCallback(async () => {
    const user = firebaseAuth.currentUser
    if (!user) return
    // Under a deadline: this is the last step before a hard navigation, so
    // a refresh that is never answered leaves the page on the waiting screen
    // it was meant to leave.
    await resolveIdToken(user, { forceRefresh: true }).catch(() => undefined)
    hardNavigate(verifiedContinueTarget(continueUrl) ?? '/')
  }, [continueUrl, firebaseAuth])

  const continueToApp = useCallback(() => {
    setContinuing(true)
    void goToApp()
  }, [goToApp])

  /**
   * `automatic` marks the send this page fires from a mount, as opposed to the
   * one a person asks for with the resend link (AGL-2584).
   *
   * The route holds a short per-uid cooldown on the automatic kind and answers
   * a suppressed one `alreadySent`, which lands on the same "we sent a link"
   * state below: coming back to this tab is a request to know whether the
   * first mail worked, not a request for another one. Identity Platform
   * throttles link minting per account ahead of our own budget, so a mount
   * that minted again is how a returning visitor was told a mail that HAD been
   * sent had failed.
   *
   * The decision is the route's rather than this component's because the
   * throttle it avoids is per account: a marker kept here would not see a link
   * minted from a phone, a second browser, or a private window.
   */
  const sendLink = useCallback(
    async ({
      automatic = false,
    }: { automatic?: boolean } = {}): Promise<boolean> => {
      const user = firebaseAuth.currentUser
      // False means nothing was asked of the route — no session to sign with
      // yet, or another request already holds the loading queue. The mount
      // send below reads it to tell "sent, and here is the outcome" apart
      // from "never left the browser", which are the same silence on screen.
      if (!user || loading) return false
      setError(null)
      const dequeueLoading = queueLoading()
      try {
        // Aglyn sends this now, not Firebase (AGL-1112) — same reason as the
        // reset mail: the Firebase template is locked, so its subject still
        // carries `[aglyn.io]` and its link lands on a firebaseapp.com host.
        // The one-time code is still minted by Firebase.
        const response = await authorizedFetch(
          user,
          '/api/auth/send-verification',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ auto: automatic }),
          },
        )
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string
          alreadyVerified?: boolean
        }
        if (response.status === 429) {
          setError(
            'Too many requests — wait a moment before requesting another link.',
          )
          return true
        }
        if (!response.ok) {
          setError(
            payload.error ??
              'We couldn’t send the verification email. Try again shortly.',
          )
          return true
        }
        // Verified in another tab while this page sat open. Sending a mail
        // whose link is already a no-op would read as the flow being stuck.
        if (payload.alreadyVerified) {
          await goToApp()
          return true
        }
        setSent(true)
      } catch (e: any) {
        console.error(e)
        setError('We couldn’t send the verification email. Try again shortly.')
      } finally {
        dequeueLoading()
      }
      return true
    },
    [firebaseAuth, goToApp, loading, queueLoading],
  )

  // Re-check verification: reload the user, and if verified, head to the app.
  // The poll, the focus re-check and the other tab's broadcast can all land
  // at once, so overlapping checks collapse into the one already running.
  const checkNow = useCallback(async () => {
    const user = firebaseAuth.currentUser
    if (!user || checkingRef.current) return
    checkingRef.current = true
    try {
      await user.reload().catch(() => undefined)
      if (user.emailVerified) {
        setContinuing(true)
        await goToApp()
      }
    } finally {
      checkingRef.current = false
    }
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
        // Refresh so `email_verified` is true on the next token the gate
        // reads when the person continues from here; without it the app
        // bounces straight back. For a session that belongs to a different,
        // already verified account the reload is a harmless no-op.
        await firebaseAuth.currentUser?.reload().catch(() => undefined)
        announceVerified()
        setApplyState('applied')
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
  }, [applying, firebaseAuth])

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
  // poll for verification. `sentOnceRef` covers this page load; the route's
  // cooldown covers the reload and the returning tab, which is where the
  // repeat sends actually came from (AGL-2584). Held while a code is being
  // applied, and never for a verified session — `sendLink` answers a verified
  // caller with `alreadyVerified`, whose `goToApp` is one more hard navigation
  // that must not race the apply. Held on the success page too: the signed-in
  // check can still report the session unverified for a beat after the apply,
  // and either exit here would carry the person off a page that exists to let
  // them choose (AGL-3384).
  const redeemed = applying || applyState === 'applied'
  useEffect(() => {
    if (redeemed || authLoading || !signedIn || sessionVerified) return
    if (!sentOnceRef.current) {
      // Marked before the await so a dependency change mid-flight cannot
      // start a second send, and released again when `sendLink` reports it
      // asked the route for nothing: the mount send is spent by a request,
      // never by a pass that arrived before there was a session to sign it
      // with. A later pass makes it, once auth and the loading queue settle.
      sentOnceRef.current = true
      void sendLink({ automatic: true }).then((asked) => {
        if (!asked) sentOnceRef.current = false
      })
    }
    const timer = setInterval(() => void checkNow(), POLL_MS)
    return () => clearInterval(timer)
  }, [redeemed, authLoading, signedIn, sessionVerified, sendLink, checkNow])

  // The waiting tab moves on the moment the link is opened (AGL-3384): at
  // once when another tab in this browser redeemed it, and on return when it
  // was redeemed anywhere else — the phone's mail app, a second browser —
  // rather than on whichever poll tick a resumed tab happens to reach next.
  useEffect(() => {
    if (applyState !== null || authLoading || !signedIn || sessionVerified)
      return
    const recheck = () => {
      if (document.visibilityState === 'visible') void checkNow()
    }
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)
    let channel: BroadcastChannel | null = null
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(VERIFIED_CHANNEL)
        channel.onmessage = () => void checkNow()
      } catch {
        channel = null
      }
    }
    return () => {
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('focus', recheck)
      channel?.close()
    }
  }, [applyState, authLoading, signedIn, sessionVerified, checkNow])

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

  if (continuing) {
    return (
      <AuthFormComponent
        headingTop={'Email verified'}
        headingBottom={`Taking you to ${PLATFORM_BRAND_NAME}`}
        headingBottomProps={{ sx: { pb: 4 }, component: LoadingTextComponent }}
        headingAfter={<CircularProgress color="primary" />}
      />
    )
  }

  // The code worked. Say so, and let the person pick where to carry on.
  if (applyState === 'applied') {
    return (
      <AuthFormComponent
        headingTop={'Email verified'}
        headingBottom={'Your email address is confirmed.'}
        headingAfter={<CheckCircleIcon color="success" sx={{ fontSize: 56 }} />}
      >
        <Stack spacing={2} sx={{ mt: 2, alignItems: 'stretch' }}>
          <Typography variant="body2" sx={{ textAlign: 'center' }}>
            {'If you signed up in another tab, head back to it — it carries ' +
              'on by itself, and you can close this one.'}
          </Typography>
          {signedIn ? (
            <Button
              variant="contained"
              color="primary"
              onClick={continueToApp}
            >
              {`Continue to ${PLATFORM_BRAND_NAME}`}
            </Button>
          ) : (
            <Button
              variant="contained"
              color="primary"
              component={AppLink}
              href="/signin"
            >
              {'Sign in to continue'}
            </Button>
          )}
          {signedIn && email ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textAlign: 'center' }}
            >
              {`Signed in as ${email}`}
            </Typography>
          ) : null}
        </Stack>
      </AuthFormComponent>
    )
  }

  // The code did not redeem, but this browser's account is already verified.
  // A used code cannot say whose it was, and by far the likeliest story is
  // that it was this person's and they opened the link twice — so this
  // leads with where they stand, not with an error (AGL-3384).
  if (applyState === 'failed' && sessionVerified) {
    return (
      <AuthFormComponent
        headingTop={'You’re already verified'}
        headingBottom={
          <>
            <b>{email ?? 'This account'}</b>
            {' is verified, so this link has nothing left to do — it has ' +
              'most likely been used already.'}
          </>
        }
        headingAfter={<CheckCircleIcon color="success" sx={{ fontSize: 56 }} />}
        paperAfter={
          <Typography component="div" variant="body2">
            {'Meant to verify a different account? '}
            <AppLink href="/signout">{'Sign out'}</AppLink>
            {' and sign in as that one.'}
          </Typography>
        }
      >
        <Stack spacing={1.5} sx={{ mt: 2, alignItems: 'stretch' }}>
          <Button variant="contained" color="primary" onClick={continueToApp}>
            {`Continue to ${PLATFORM_BRAND_NAME}`}
          </Button>
        </Stack>
      </AuthFormComponent>
    )
  }

  // A failed apply with no session to fall through to: the resend flow below
  // needs a signed-in unverified user, so this gets its own terminal view
  // instead of a silent redirect (AGL-1524). A link that was already used is
  // the common case, and it means the address IS verified — the copy says so
  // rather than sending them hunting for a fresh one they do not need.
  if (applyState === 'failed' && !signedIn) {
    return (
      <AuthFormComponent
        headingTop={'Verify your email'}
        headingBottom={'This link has expired or was already used'}
      >
        <Stack spacing={2} sx={{ mt: 2, alignItems: 'stretch' }}>
          <Typography variant="body2" sx={{ textAlign: 'center' }}>
            {'If you already opened it once, your email is verified — sign ' +
              'in to continue. If not, sign in and we’ll send you a new link.'}
          </Typography>
          <Button
            variant="contained"
            color="primary"
            component={AppLink}
            href="/signin"
          >
            {'Sign in'}
          </Button>
        </Stack>
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
