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
import { FIELD_SCHEMA_EMAIL } from '@aglyn/shared-data-forms'
import { AppLink, useLoading } from '@aglyn/shared-ui-jsx'
import type { FormSchema } from '@aglyn/shared-ui-jsx-forms'
import { FormRenderer, simpleComponentMapper } from '@aglyn/shared-ui-jsx-forms'
import { Link, Typography } from '@mui/material'
import { useCallback, useState } from 'react'
import AuthErrorAlertComponent from '../../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../../components/auth-form-template.component'
import AuthFormComponent from '../../../components/auth-form.component'

const formSchema: FormSchema = {
  submitLabel: 'Send reset link',
  fields: [FIELD_SCHEMA_EMAIL],
}

function AccountRecovery() {
  const { queueLoading, loading } = useLoading()
  const [error, setError] = useState<AuthResultError>(null)
  // Once the email is dispatched we swap the form for a confirmation step —
  // this is the first leg of Firebase's out-of-band reset flow (AGL-475).
  const [sentTo, setSentTo] = useState<string | null>(null)

  const sendReset = useCallback(
    async (email: string) => {
      if (loading) return
      if (error) setError(null)
      const dequeueLoading = queueLoading()
      try {
        // Aglyn sends this now, not Firebase (AGL-1112). The client SDK's
        // `sendPasswordResetEmail` had Firebase compose it from a template
        // nobody can edit — the subject still said `[aglyn.io]` and the link
        // landed on `aglyn-main.firebaseapp.com`. Firebase still mints the
        // one-time code, which is the part that has to be Firebase's.
        //
        // Anti-enumeration moved to the server with the send: the route
        // answers 200 for every address, so there is no longer a client-side
        // error code to special-case. A missing account and a real one are
        // now indistinguishable from here, which is stronger than catching
        // `USER_DELETED` was — that relied on every other failure mode
        // producing a different code.
        const response = await fetch('/api/auth/send-password-reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        if (!response.ok) throw new Error(`Request failed (${response.status})`)
        setSentTo(email)
      } catch (error) {
        console.error(error)
        setError(error as AuthResultError)
      } finally {
        dequeueLoading()
      }
    },
    [error, loading, queueLoading],
  )

  const handleFormSubmit = useCallback(
    async (values) => {
      await sendReset(values[FIELD_SCHEMA_EMAIL.name])
    },
    [sendReset],
  )
  const handleResend = useCallback(async () => {
    if (sentTo) await sendReset(sentTo)
  }, [sendReset, sentTo])

  if (sentTo) {
    return (
      <AuthFormComponent
        headingTop={'Check your email'}
        headingBottom={
          <>
            {'We sent a password reset link to '}
            <b>{sentTo}</b>
            {'. Open it to choose a new password — the link expires after a'}
            {' short while.'}
          </>
        }
        paperAfter={
          <Typography component="div" variant="body2">
            {'Didn’t get it? '}
            <Link
              component="button"
              type="button"
              variant="body2"
              onClick={handleResend}
              disabled={loading}
            >
              {'Resend'}
            </Link>
            {' or '}
            <AppLink href="/signin">{'back to sign in'}</AppLink>
          </Typography>
        }
      >
        <AuthErrorAlertComponent error={error} sx={{ mt: 2, mb: 1 }} />
      </AuthFormComponent>
    )
  }

  return (
    <AuthFormComponent
      paperTop={
        <Typography
          component="div"
          variant="body2"
          sx={{ alignSelf: 'flex-end' }}
        >
          <AppLink href="/signin">{'Sign in'}</AppLink>
        </Typography>
      }
      headingTop={'Account recovery'}
      headingBottom={'Enter your email and we’ll send a link to reset your password'}
      paperAfter={
        <Typography component="div" variant="body2">
          {'Remembered your password? '}
          <AppLink href="/signin">{'Sign in'}</AppLink>
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
    </AuthFormComponent>
  )
}
AccountRecovery.displayName = 'Page:AccountRecovery'

export default AccountRecovery
