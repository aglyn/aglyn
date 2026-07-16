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
import { APP_CONSOLE } from '@aglyn/shared-data-enums'
import {
  FIELD_SCHEMA_PASSWORD,
  FIELD_SCHEMA_PASSWORD_CONFIRM,
} from '@aglyn/shared-data-forms'
import { AppLink, LoadingTextComponent, useLoading } from '@aglyn/shared-ui-jsx'
import type { FormSchema } from '@aglyn/shared-ui-jsx-forms'
import { FormRenderer, simpleComponentMapper } from '@aglyn/shared-ui-jsx-forms'
import { useNextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { CircularProgress, Typography } from '@mui/material'
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useAuth } from '@aglyn/tenant-feature-instance'
import AuthErrorAlertComponent from '../../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../../components/auth-form-template.component'
import AuthFormComponent from '../../../components/auth-form.component'

const formSchema: FormSchema = {
  submitLabel: 'Reset password',
  fields: [FIELD_SCHEMA_PASSWORD, FIELD_SCHEMA_PASSWORD_CONFIRM],
}

type ResetStatus = 'verifying' | 'ready' | 'invalid' | 'done'

/**
 * Second leg of Firebase's out-of-band reset flow (AGL-475): the emailed link
 * lands here carrying `?mode=resetPassword&oobCode=…`. We verify the code,
 * collect a new password, then commit it. The Firebase console action URL must
 * point at this route for the link to reach us (see docs).
 */
function ResetPasswordInner() {
  useNextPageTitle({
    screen: 'Reset password',
    suffix: APP_CONSOLE.AFFIX,
    separator: ` ${APP_CONSOLE.SEP} `,
  })
  const searchParams = useSearchParams()
  const oobCode = searchParams.get('oobCode')
  const mode = searchParams.get('mode')
  const firebaseAuth = useAuth()
  const { queueLoading, loading } = useLoading()
  const [error, setError] = useState<AuthResultError>(null)
  const [status, setStatus] = useState<ResetStatus>('verifying')
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    // Reject anything that isn't a reset link before we hit the network.
    if (!oobCode || (mode && mode !== 'resetPassword')) {
      setStatus('invalid')
      return
    }
    let active = true
    void verifyPasswordResetCode(firebaseAuth, oobCode)
      .then((verifiedEmail) => {
        if (!active) return
        setEmail(verifiedEmail)
        setStatus('ready')
      })
      .catch((error) => {
        if (!active) return
        console.error(error)
        setError(error)
        setStatus('invalid')
      })
    return () => {
      active = false
    }
  }, [firebaseAuth, mode, oobCode])

  const handleFormSubmit = useCallback(
    async (values) => {
      if (loading || !oobCode) return
      if (error) setError(null)
      const dequeueLoading = queueLoading()
      await confirmPasswordReset(
        firebaseAuth,
        oobCode,
        values[FIELD_SCHEMA_PASSWORD.name],
      )
        .then(() => setStatus('done'))
        .catch((error) => {
          console.error(error)
          setError(error)
        })
        .finally(() => dequeueLoading())
    },
    [error, firebaseAuth, loading, oobCode, queueLoading],
  )

  if (status === 'verifying') {
    return (
      <AuthFormComponent
        headingTop={'Reset password'}
        headingBottom={'Verifying your link'}
        headingBottomProps={{
          sx: { pb: 4 },
          component: LoadingTextComponent,
        }}
        headingAfter={<CircularProgress color="secondary" />}
      />
    )
  }

  if (status === 'invalid') {
    return (
      <AuthFormComponent
        headingTop={'Link expired'}
        headingBottom={
          'This password reset link is invalid or has already been used.'
        }
        paperAfter={
          <Typography component="div" variant="body2">
            <AppLink href="/account-recovery">
              {'Request a new reset link'}
            </AppLink>
          </Typography>
        }
      >
        <AuthErrorAlertComponent error={error} sx={{ mt: 2, mb: 1 }} />
      </AuthFormComponent>
    )
  }

  if (status === 'done') {
    return (
      <AuthFormComponent
        headingTop={'Password updated'}
        headingBottom={
          'Your password has been reset. Sign in with your new password.'
        }
        paperAfter={
          <Typography component="div" variant="body2">
            <AppLink href="/signin">{'Go to sign in'}</AppLink>
          </Typography>
        }
      />
    )
  }

  return (
    <AuthFormComponent
      headingTop={'Choose a new password'}
      headingBottom={
        email ? (
          <>
            {'for '}
            <b>{email}</b>
          </>
        ) : (
          'Enter a new password for your account'
        )
      }
      paperAfter={
        <Typography component="div" variant="body2">
          <AppLink href="/signin">{'Back to sign in'}</AppLink>
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

function ResetPassword() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense
      fallback={
        <AuthFormComponent
          headingTop={'Reset password'}
          headingBottom={'Loading'}
          headingBottomProps={{
            sx: { pb: 4 },
            component: LoadingTextComponent,
          }}
          headingAfter={<CircularProgress color="secondary" />}
        />
      }
    >
      <ResetPasswordInner />
    </Suspense>
  )
}
ResetPassword.displayName = 'Page:ResetPassword'

export default ResetPassword
