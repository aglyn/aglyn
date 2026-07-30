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

import type { AuthResultError } from '@aglyn/shared-data-enums'
import {
  FIELD_SCHEMA_EMAIL,
  FIELD_SCHEMA_PASSWORD,
} from '@aglyn/shared-data-forms'
import {
  AppLink,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import type { FormSchema } from '@aglyn/shared-ui-jsx-forms'
import { FormRenderer, simpleComponentMapper } from '@aglyn/shared-ui-jsx-forms'
import {
  mdiGoogle,
  mdiShieldKeyOutline,
} from '@aglyn/shared-data-mdi'
import {
  MdiIcon,
} from '@aglyn/shared-ui-jsx'
import { LoadingTextComponent } from '@aglyn/shared-ui-jsx'
import { Button, CircularProgress, Divider, Link, Stack, Typography } from '@mui/material'
import { logEvent } from 'firebase/analytics'
import {
  browserLocalPersistence,
  getRedirectResult,
  GoogleAuthProvider,
  SAMLAuthProvider,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth'
import { useCallback, useEffect, useState } from 'react'
import {
  useAnalytics,
  useAuth,
  useSigninCheck,
} from '@aglyn/tenant-feature-instance'
import AuthErrorAlertComponent from '../../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../../components/auth-form-template.component'
import AuthFormComponent from '../../../components/auth-form.component'
import { AuthLegalNotice } from '../../../components/auth-legal-consent.component'
import AuthenticatingLayout from '../../../components/layouts/authenticating.layout'
import useDelegateWorkspaceSignIn from '../../../hooks/use-delegate-workspace-signin'
import useGoogleRedirectResult from '../../../hooks/use-google-redirect-result'
import { authSignInHost } from '../../../utils/auth-delegation'
import { markInteractiveSignIn } from '../../../utils/interactive-signin'
import isMobileBrowser from '../../../utils/is-mobile-browser'
import guardPopupLoading from '../../../utils/popup-loading-guard'

const googleOAuthProvider = new GoogleAuthProvider()

// Enterprise SSO (AGL-1101): the SAML redirect leaves and returns to this
// page, and `auth.tenantId` must be restored BEFORE `getRedirectResult` for
// the tenant round-trip to resolve — so we stash the tenant across the hop.
const SSO_PENDING_KEY = 'aglyn.sso.pending'

const formSchema: FormSchema = {
  fields: [FIELD_SCHEMA_EMAIL, FIELD_SCHEMA_PASSWORD],
}

function SignIn() {
  const { queueLoading, loading } = useLoading()
  const firebaseAuth = useAuth()
  const [error, setError] = useState<AuthResultError>(null)
  const analytics = useAnalytics()
  // Org workspace subdomains can't run OAuth — hand sign-in to the auth
  // host and skip the local form/redirect-result entirely (AGL-465).
  const delegation = useDelegateWorkspaceSignIn('signin')
  // A pending SSO redirect owns `getRedirectResult` this load (it must set
  // `auth.tenantId` first), so the Google handler stands down to avoid
  // double-consuming the one-shot result.
  const ssoPending =
    typeof window !== 'undefined' &&
    !!window.sessionStorage.getItem(SSO_PENDING_KEY)
  // Mobile browsers sign in via redirect (AGL-462); this completes the
  // round-trip when Google sends the user back here.
  useGoogleRedirectResult('login', setError, delegation === 'off' && !ssoPending)
  // Once auth succeeds there's a short window before the layout redirects to
  // the dashboard/continue URL; show the loading splash instead of flashing
  // the sign-in form back at the user (AGL-476).
  const { data: signInCheckResult } = useSigninCheck()
  const signedIn = signInCheckResult?.signedIn === true

  const handleSignIn = useCallback(
    async (values?: any) => {
      if (loading) return
      if (error) setError(null)
      const dequeueLoading = queueLoading()
      // Popup flows can wedge the overlay if the popup handle is severed
      // and the SDK never rejects — see guardPopupLoading (AGL-459).
      const releaseGuard = values
        ? undefined
        : guardPopupLoading(dequeueLoading)
      // Flag the interactive sign-in BEFORE it starts so it survives the
      // mobile redirect round-trip; the session hook mints the shared
      // cookie on return instead of validating a stale one (AGL-463).
      markInteractiveSignIn()
      await setPersistence(firebaseAuth, browserLocalPersistence)
        .then(() => {
          if (values) {
            return signInWithEmailAndPassword(
              firebaseAuth,
              values[FIELD_SCHEMA_EMAIL.name],
              values[FIELD_SCHEMA_PASSWORD.name],
            )
          }
          // Mobile popups become tabs whose result never reaches the SDK
          // (AGL-462) — the redirect flow is the only reliable path there.
          // The overlay stays queued until the browser navigates away.
          return isMobileBrowser()
            ? signInWithRedirect(firebaseAuth, googleOAuthProvider)
            : signInWithPopup(firebaseAuth, googleOAuthProvider)
        })
        .then((user) => {
          logEvent(analytics, 'login', {
            method: user.providerId,
          })
        })
        .catch((error) => {
          console.error(error)
          setError({
            ...error,
            credential: GoogleAuthProvider.credentialFromError(error),
          })
        })
        .finally(() => {
          releaseGuard?.()
          dequeueLoading()
        })
    },
    [error, firebaseAuth, loading, queueLoading],
  )

  const handleFormSubmit = useCallback(
    async (values) => {
      await handleSignIn(values)
    },
    [handleSignIn],
  )
  const handleGoogleButtonClick = useCallback(async () => {
    await handleSignIn()
  }, [handleSignIn])

  // Enterprise SSO (AGL-1101): look up the entered email's domain; if it is
  // governed by an IdP, set the org's GCIP tenant on the client auth and hand
  // off to the SAML redirect. Falls through to a clear error for a domain with
  // no SSO, so password/Google stay usable (no lockout).
  const handleSsoSignIn = useCallback(async () => {
    if (loading) return
    if (error) setError(null)
    const emailInput =
      typeof document !== 'undefined'
        ? (document.querySelector(
            `input[name="${FIELD_SCHEMA_EMAIL.name}"]`,
          ) as HTMLInputElement | null)
        : null
    const email = (emailInput?.value ?? '').trim().toLowerCase()
    if (!email) {
      setError({ message: 'Enter your work email to use single sign-on.' } as any)
      return
    }
    const dequeueLoading = queueLoading()
    let navigatingAway = false
    try {
      const res = await fetch(
        `/api/auth/sso-lookup?email=${encodeURIComponent(email)}`,
      )
      const payload = await res.json().catch(() => ({}))
      if (!payload?.ssoEnabled || !payload.tenantId || !payload.providerId) {
        setError({
          message: 'No single sign-on is configured for that email domain.',
        } as any)
        return
      }
      markInteractiveSignIn()
      await setPersistence(firebaseAuth, browserLocalPersistence)
      firebaseAuth.tenantId = payload.tenantId
      const provider = new SAMLAuthProvider(payload.providerId)
      if (isMobileBrowser()) {
        // Mobile popups become tabs (AGL-462) — redirect, and the completion
        // effect finishes the round-trip on return. Requires the app origin to
        // be same-site with the auth domain (true on the real deployment).
        navigatingAway = true
        window.sessionStorage.setItem(
          SSO_PENDING_KEY,
          JSON.stringify({ tenantId: payload.tenantId }),
        )
        await signInWithRedirect(firebaseAuth, provider)
        return
      }
      // Desktop: popup (like the Google button). The result posts back via
      // postMessage, so it works even when the app origin isn't same-site with
      // the auth domain — and lets us JIT-map inline without a redirect hop.
      const result = await signInWithPopup(firebaseAuth, provider)
      const idToken = await result.user.getIdToken()
      const jit = await fetch('/api/auth/sso-jit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      })
      if (!jit.ok) {
        const jitPayload = await jit.json().catch(() => ({}))
        setError({
          message:
            jitPayload?.error ??
            'Signed in, but your account is not authorized for this organization.',
        } as any)
      }
      // Success: useSessionCookie mints the tenant cookie and signInCheck flips
      // to signedIn, which routes to the org — the loading splash covers it.
    } catch (err) {
      console.error(err)
      setError(err as any)
      window.sessionStorage.removeItem(SSO_PENDING_KEY)
    } finally {
      if (!navigatingAway) dequeueLoading()
    }
  }, [error, firebaseAuth, loading, queueLoading])

  // Complete a returning SAML redirect (AGL-1101): restore the tenant, consume
  // the result, and JIT-map the user into their org before the layout routes.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = window.sessionStorage.getItem(SSO_PENDING_KEY)
    if (!raw) return
    let pending: { tenantId?: string } = {}
    try {
      pending = JSON.parse(raw)
    } catch {
      /* corrupt — cleared below */
    }
    if (!pending.tenantId) {
      window.sessionStorage.removeItem(SSO_PENDING_KEY)
      return
    }
    let cancelled = false
    const dequeueLoading = queueLoading()
    void (async () => {
      try {
        firebaseAuth.tenantId = pending.tenantId ?? null
        const result = await getRedirectResult(firebaseAuth)
        if (!result?.user) {
          window.sessionStorage.removeItem(SSO_PENDING_KEY)
          return
        }
        const idToken = await result.user.getIdToken()
        const jit = await fetch('/api/auth/sso-jit', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
        })
        if (!jit.ok) {
          const payload = await jit.json().catch(() => ({}))
          if (!cancelled) {
            setError({
              message:
                payload?.error ??
                'Signed in, but your account is not authorized for this organization.',
            } as any)
          }
        }
        window.sessionStorage.removeItem(SSO_PENDING_KEY)
        // useSessionCookie mints the tenant-aware cookie; signInCheck flips to
        // signedIn and the layout routes to the org dashboard.
      } catch (err) {
        if (!cancelled) {
          console.error(err)
          setError(err as any)
        }
        window.sessionStorage.removeItem(SSO_PENDING_KEY)
      } finally {
        dequeueLoading()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [firebaseAuth, queueLoading])

  if (delegation === 'redirecting') {
    // Bouncing to the auth host (AGL-465) — no local form or OAuth here.
    return (
      <AuthFormComponent
        headingTop={'Redirecting'}
        headingBottom={'Taking you to sign in'}
        headingBottomProps={{
          sx: { pb: 4 },
          component: LoadingTextComponent,
        }}
        headingAfter={<CircularProgress color="secondary" />}
      />
    )
  }
  if (signedIn) {
    // Authenticated — the layout is about to route to the dashboard/continue
    // URL. Hold the loading screen so the form doesn't flash back (AGL-476).
    return (
      <AuthFormComponent
        headingTop={'Signing in'}
        headingBottom={'One moment'}
        headingBottomProps={{
          sx: { pb: 4 },
          component: LoadingTextComponent,
        }}
        headingAfter={<CircularProgress color="secondary" />}
      />
    )
  }
  if (delegation === 'stopped') {
    // Delegation kept coming back session-less (AGL-467) — surface an escape
    // instead of an endless spinner.
    return (
      <AuthFormComponent
        headingTop={'Sign-in didn’t complete'}
        headingBottom={'We couldn’t establish your session on this workspace.'}
        paperAfter={
          <Typography component="div" variant="body2">
            <Link href={`https://${authSignInHost()}/signin`}>
              {'Sign in again'}
            </Link>
          </Typography>
        }
      />
    )
  }

  return (
    <AuthFormComponent
      paperTop={
        <Typography component="div" variant="body2" sx={{
          alignSelf: "flex-end"
        }}>
          <AppLink href="/signup">{'Create account'}</AppLink>
        </Typography>
      }
      headingTop={'Sign in'}
      headingBottom={'Use your Aglyn account'}
      paperAfter={
        <Typography component="div" variant="body2">
          {'Having trouble logging in? '}
          <AppLink href="/account-recovery">{'Account recovery'}</AppLink>
        </Typography>
      }
    >
      <FormRenderer
        FormTemplate={AuthFormTemplateComponent}
        componentMapper={simpleComponentMapper}
        onSubmit={handleFormSubmit}
        schema={formSchema}
        subscription={{ values: true }}
        clearOnUnmount
      />
      <AuthErrorAlertComponent error={error} sx={{ mt: 2, mb: 1 }} />
      <Divider flexItem variant="middle" sx={{ my: 3 }}>
        {'Or sign in with'}
      </Divider>
      <Stack
        direction="column"
        spacing={1}
        sx={{
          justifyContent: "center",
          alignItems: "stretch",
          paddingBottom: 2
        }}>
        <Button
          variant="outlined"
          startIcon={<MdiIcon path={mdiGoogle.path} />}
          onClick={handleGoogleButtonClick}
        >
          {'Google'}
        </Button>
        <Button
          variant="outlined"
          startIcon={<MdiIcon path={mdiShieldKeyOutline.path} />}
          onClick={handleSsoSignIn}
        >
          {'Single sign-on (SSO)'}
        </Button>
      </Stack>
      <AuthLegalNotice />
    </AuthFormComponent>
  );
}
SignIn.displayName = 'Page:SignIn'

export default SignIn
