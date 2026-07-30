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

import { FIELD_SCHEMA_EMAIL } from '@aglyn/shared-data-forms'
import {
  AppLink,
  LoadingTextComponent,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import type { FormSchema } from '@aglyn/shared-ui-jsx-forms'
import { FormRenderer, simpleComponentMapper } from '@aglyn/shared-ui-jsx-forms'
import { CircularProgress, Typography } from '@mui/material'
import {
  browserLocalPersistence,
  getRedirectResult,
  SAMLAuthProvider,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth'
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useSigninCheck } from '@aglyn/tenant-feature-instance'
import AuthErrorAlertComponent from '../../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../../components/auth-form-template.component'
import AuthFormComponent from '../../../components/auth-form.component'
import { markInteractiveSignIn } from '../../../utils/interactive-signin'
import isMobileBrowser from '../../../utils/is-mobile-browser'

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
  const [error, setError] = useState<{ message?: string } | null>(null)
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
        if (!jit.ok && !cancelled) {
          const payload = await jit.json().catch(() => ({}))
          setError({
            message:
              payload?.error ??
              'Signed in, but your account is not authorized for this organization.',
          })
        }
        window.sessionStorage.removeItem(SSO_PENDING_KEY)
      } catch (err) {
        if (!cancelled) {
          console.error(err)
          setError(err as { message?: string })
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
        setError({ message: 'Enter your work email to continue.' })
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
            message:
              'No single sign-on is set up for that email domain. Use your ' +
              'password or Google on the sign-in page instead.',
          })
          return
        }
        markInteractiveSignIn()
        await setPersistence(firebaseAuth, browserLocalPersistence)
        firebaseAuth.tenantId = payload.tenantId
        const provider = new SAMLAuthProvider(payload.providerId)
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
            message:
              jitPayload?.error ??
              'Signed in, but your account is not authorized for this organization.',
          })
        }
      } catch (err) {
        console.error(err)
        setError(err as { message?: string })
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
        headingAfter={<CircularProgress color="secondary" />}
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
