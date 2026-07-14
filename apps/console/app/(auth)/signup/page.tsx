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
  FIELD_SCHEMA_EMAIL,
  FIELD_SCHEMA_FIRST_NAME,
  FIELD_SCHEMA_LAST_NAME,
  FIELD_SCHEMA_PASSWORD,
  FIELD_SCHEMA_PASSWORD_CONFIRM,
} from '@aglyn/shared-data-forms'
import {
  AppLink,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import type { FormSchema } from '@aglyn/shared-ui-jsx-forms'
import { FormRenderer, simpleComponentMapper } from '@aglyn/shared-ui-jsx-forms'
import {
  mdiGoogle,
} from '@aglyn/shared-data-mdi'
import {
  MdiIcon,
} from '@aglyn/shared-ui-jsx'
import { useNextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { LoadingTextComponent } from '@aglyn/shared-ui-jsx'
import { Button, CircularProgress, Divider, Link, Stack, Typography } from '@mui/material'
import { logEvent } from 'firebase/analytics'
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth'
import { useCallback, useState } from 'react'
import { useAnalytics, useAuth } from '@aglyn/tenant-feature-instance'
import AuthErrorAlertComponent from '../../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../../components/auth-form-template.component'
import AuthFormComponent from '../../../components/auth-form.component'
import AuthenticatingLayout from '../../../components/layouts/authenticating.layout'
import useDelegateWorkspaceSignIn from '../../../hooks/use-delegate-workspace-signin'
import useGoogleRedirectResult from '../../../hooks/use-google-redirect-result'
import { authSignInHost } from '../../../utils/auth-delegation'
import { markInteractiveSignIn } from '../../../utils/interactive-signin'
import isMobileBrowser from '../../../utils/is-mobile-browser'
import guardPopupLoading from '../../../utils/popup-loading-guard'

const googleOAuthProvider = new GoogleAuthProvider()

const formSchema: FormSchema = {
  fields: [
    FIELD_SCHEMA_FIRST_NAME,
    FIELD_SCHEMA_LAST_NAME,
    FIELD_SCHEMA_EMAIL,
    FIELD_SCHEMA_PASSWORD,
    FIELD_SCHEMA_PASSWORD_CONFIRM,
  ],
}

function SignUp() {
  useNextPageTitle({
    screen: 'Sign up',
    suffix: APP_CONSOLE.AFFIX,
    separator: ` ${APP_CONSOLE.SEP} `,
  })
  const { queueLoading, loading } = useLoading()
  const firebaseAuth = useAuth()
  const [error, setError] = useState<AuthResultError>(null)
  const analytics = useAnalytics()
  // Org workspace subdomains can't run OAuth — hand sign-in to the auth
  // host and skip the local form/redirect-result entirely (AGL-465).
  const delegation = useDelegateWorkspaceSignIn('signup')
  // Mobile browsers sign in via redirect (AGL-462); this completes the
  // round-trip when Google sends the user back here.
  useGoogleRedirectResult('sign_up', setError, delegation === 'off')

  const handleSignUp = useCallback(
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
            return createUserWithEmailAndPassword(
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
          logEvent(analytics, 'sign_up', {
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
    [analytics, error, firebaseAuth, loading, queueLoading],
  )

  const handleFormSubmit = useCallback(
    async (values) => {
      await handleSignUp(values)
    },
    [handleSignUp],
  )
  const handleGoogleButtonClick = useCallback(async () => {
    await handleSignUp()
  }, [handleSignUp])

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
          <AppLink href="/signin">{'Sign in'}</AppLink>
        </Typography>
      }
      headingTop={'Sign up'}
      headingBottom={'Create a new Aglyn Account'}
      paperAfter={
        <Typography component="div" variant="body2">
          {'Already have an account? '}
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
      <Divider flexItem variant="middle" sx={{ my: 3 }}>
        {'Or sign up with'}
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
      </Stack>
    </AuthFormComponent>
  );
}
SignUp.displayName = 'Page:SignUp'

export default SignUp
