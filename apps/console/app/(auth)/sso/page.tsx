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

import { trackEvent } from '@aglyn/aglyn/app-utils/analytics-events'
import { FIELD_SCHEMA_EMAIL } from '@aglyn/shared-data-forms'
import { AppLink, useLoading } from '@aglyn/shared-ui-jsx'
import { LoadingTextComponent } from '@aglyn/shared-ui-jsx/components/loading-text.component'
import type { FormSchema } from '@aglyn/shared-ui-jsx-forms'
import { FormRenderer, simpleComponentMapper } from '@aglyn/shared-ui-jsx-forms'
import { CircularProgress, Typography } from '@mui/material'
import {
  browserLocalPersistence,
  getRedirectResult,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth'
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useSigninCheck } from '@aglyn/tenant-feature-instance'
import { AuthAppErrorCodes } from '@aglyn/shared-data-enums'
import AuthErrorAlertComponent from '../../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../../components/auth-form-template.component'
import AuthFormComponent from '../../../components/auth-form.component'
import { markInteractiveSignIn } from '../../../utils/interactive-signin'
import isMobileBrowser from '../../../utils/is-mobile-browser'
import { createAuthProvider } from '../../../utils/oauth-providers'
import { describeSsoError } from '../../../utils/sso-errors'

// Enterprise SSO (AGL-1101): the SAML redirect leaves and returns here, so the
// tenant is stashed across the hop and restored before getRedirectResult.
const SSO_PENDING_KEY = 'aglyn.sso.pending'

const ssoSchema: FormSchema & { submitLabel?: string } = {
  fields: [FIELD_SCHEMA_EMAIL],
  submitLabel: 'Continue with SSO',
}

/**
 * Dedicated single-sign-on entry (AGL-1101). Enterprise SSO pages ask only for
 * a work email/domain as step one — no password or social buttons — then hand
 * off to the org's IdP. This page is that step, kept separate from the primary
 * `/signin` form; a "back to sign in" link rescues anyone who lands here by
 * mistake. Desktop uses a popup (posts back via postMessage, so it works even
 * off the same-site auth domain); mobile redirects.
 */
function SsoSignIn() {
  const firebaseAuth = useAuth()
  const { queueLoading, loading } = useLoading()
  // `code` is not optional decoration: `AuthErrorAlertComponent` renders
  // nothing without one, so an error built as `{ message }` alone is dropped
  // on the floor — which is what happened to every message this page wrote
  // for itself before AGL-1416.
  const [error, setError] = useState<{
    code?: string
    message?: string
  } | null>(null)
  const { data: signInCheckResult } = useSigninCheck()
  const signedIn = signInCheckResult?.signedIn === true

  // Complete a returning SAML redirect (mobile path): restore the tenant,
  // consume the result, and JIT-map before the layout routes.
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
          if (!cancelled) {
            const payload = await jit.json().catch(() => ({}))
            setError({
              code: AuthAppErrorCodes.SSO_NOT_AUTHORIZED,
              message:
                payload?.error ??
                'Signed in, but your account is not authorized for this organization.',
            })
          }
        } else {
          // The mobile half of the SSO login event (AGL-1562). Fired here and
          // not on `getRedirectResult` alone: an authenticated user the JIT
          // mapping refuses is not a session in anyone's workspace, and
          // counting them would make "logins" and "people who got in"
          // different numbers with the same name. Not gated on `cancelled` —
          // that flag is about whether this component may still write state,
          // and the sign-in happened either way.
          trackEvent('login', { method: 'sso' })
        }
        window.sessionStorage.removeItem(SSO_PENDING_KEY)
      } catch (err) {
        if (!cancelled) {
          console.error(err)
          // The mobile half of the same misdirection: the redirect returns
          // carrying Google's verdict, and passing it through raw is what
          // sends people to their administrator (AGL-1416).
          setError(describeSsoError(err))
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

  const handleContinue = useCallback(
    async (rawEmail: string) => {
      if (loading) return
      if (error) setError(null)
      const value = (rawEmail ?? '').trim().toLowerCase()
      if (!value || !value.includes('@')) {
        setError({
          code: AuthAppErrorCodes.SSO_INPUT_REQUIRED,
          message: 'Enter your work email to continue.',
        })
        return
      }
      const dequeueLoading = queueLoading()
      let navigatingAway = false
      try {
        const res = await fetch(
          `/api/auth/sso-lookup?email=${encodeURIComponent(value)}`,
        )
        const payload = await res.json().catch(() => ({}))
        if (!payload?.ssoEnabled || !payload.tenantId || !payload.providerId) {
          setError({
            code: AuthAppErrorCodes.SSO_NOT_CONFIGURED,
            message: 'No single sign-on is set up for that email domain.',
          })
          return
        }
        markInteractiveSignIn()
        await setPersistence(firebaseAuth, browserLocalPersistence)
        firebaseAuth.tenantId = payload.tenantId
        // The typed email rides along as `login_hint` (AGL-1416). Without it
        // Google resolves the SAML request against whichever account is
        // `authuser=0`, so sign-in depends on browser account ordering — an
        // input the user cannot see and never chose.
        const provider = createAuthProvider(payload.providerId, value)
        if (isMobileBrowser()) {
          navigatingAway = true
          window.sessionStorage.setItem(
            SSO_PENDING_KEY,
            JSON.stringify({ tenantId: payload.tenantId }),
          )
          await signInWithRedirect(firebaseAuth, provider)
          return
        }
        const result = await signInWithPopup(firebaseAuth, provider)
        const idToken = await result.user.getIdToken()
        const jit = await fetch('/api/auth/sso-jit', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
        })
        if (!jit.ok) {
          const jitPayload = await jit.json().catch(() => ({}))
          setError({
            code: AuthAppErrorCodes.SSO_NOT_AUTHORIZED,
            message:
              jitPayload?.error ??
              'Signed in, but your account is not authorized for this organization.',
          })
        } else {
          // Enterprise sign-in, counted at last (AGL-1562). `LoginMethod` has
          // carried an `'sso'` member since AGL-1561 with nothing sending it,
          // so every SAML sign-in read as no sign-in at all.
          //
          // `login` only — deliberately no `sign_up` for a JIT-provisioned
          // account. JIT creates accounts without passing any of the four
          // AGL-1497 clickwrap doors, because an enterprise user is covered by
          // their org's negotiated agreement instead; feeding those into the
          // same funnel as self-serve signups would make "signup → paid
          // conversion" meaningless, since an SSO user arrives already sold.
          // Enterprise seat counts are a billing question, not a funnel one.
          trackEvent('login', { method: 'sso' })
        }
      } catch (err) {
        console.error(err)
        // Classified rather than passed through raw: Google's own wording
        // blames the administrator for something only the user can fix.
        setError(describeSsoError(err))
        window.sessionStorage.removeItem(SSO_PENDING_KEY)
      } finally {
        if (!navigatingAway) dequeueLoading()
      }
    },
    [error, firebaseAuth, loading, queueLoading],
  )

  const handleFormSubmit = useCallback(
    async (values: Record<string, unknown>) => {
      await handleContinue(String(values[FIELD_SCHEMA_EMAIL.name] ?? ''))
    },
    [handleContinue],
  )

  if (signedIn) {
    return (
      <AuthFormComponent
        headingTop={'Signing in'}
        headingBottom={'One moment'}
        headingBottomProps={{ sx: { pb: 4 }, component: LoadingTextComponent }}
        headingAfter={<CircularProgress color="primary" />}
      />
    )
  }

  return (
    <AuthFormComponent
      headingTop={'Single sign-on'}
      headingBottom={
        "Enter your work email and we'll take you to your organization's sign-in"
      }
      paperAfter={
        <Typography component="div" variant="body2">
          <AppLink href="/signin">{'← Back to sign in'}</AppLink>
        </Typography>
      }
    >
      <FormRenderer
        FormTemplate={AuthFormTemplateComponent}
        componentMapper={simpleComponentMapper}
        onSubmit={handleFormSubmit}
        schema={ssoSchema}
        clearOnUnmount
      />
      <AuthErrorAlertComponent error={error as never} sx={{ mt: 2 }} />
    </AuthFormComponent>
  )
}
SsoSignIn.displayName = 'Page:SsoSignIn'

export default SsoSignIn
