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

import type { AuthResultError } from '@aglyn/shared-data-enums'
import { APP_CONSOLE } from '@aglyn/shared-data-enums'
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
} from '@aglyn/shared-data-mdi'
import {
  MdiIcon,
} from '@aglyn/shared-ui-jsx'
import { useNextPageTitle } from '@aglyn/shared-ui-next'
import { Button, Divider, Stack, Typography } from '@mui/material'
import { logEvent } from 'firebase/analytics'
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth'
import { useCallback, useState } from 'react'
import { useAnalytics, useAuth } from '@aglyn/tenant-feature-instance'
import AuthErrorAlertComponent from '../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../components/auth-form-template.component'
import AuthFormComponent from '../../components/auth-form.component'
import AuthenticatingLayout from '../../components/layouts/authenticating.layout'

const googleOAuthProvider = new GoogleAuthProvider()

const formSchema: FormSchema = {
  fields: [FIELD_SCHEMA_EMAIL, FIELD_SCHEMA_PASSWORD],
}

function SignIn() {
  useNextPageTitle({
    screen: 'Sign in',
    suffix: APP_CONSOLE.AFFIX,
    separator: ` ${APP_CONSOLE.SEP} `,
  })
  const { queueLoading, loading } = useLoading()
  const firebaseAuth = useAuth()
  const [error, setError] = useState<AuthResultError>(null)
  const analytics = useAnalytics()

  const handleSignIn = useCallback(
    async (values?: any) => {
      if (loading) return
      if (error) setError(null)
      const dequeueLoading = queueLoading()
      await setPersistence(firebaseAuth, browserLocalPersistence)
        .then(() => {
          if (values) {
            return signInWithEmailAndPassword(
              firebaseAuth,
              values[FIELD_SCHEMA_EMAIL.name],
              values[FIELD_SCHEMA_PASSWORD.name],
            )
          }
          return signInWithPopup(firebaseAuth, googleOAuthProvider)
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
      </Stack>
    </AuthFormComponent>
  );
}
SignIn.displayName = 'Page:SignIn'
SignIn.layouts = [
  {
    Component: AuthenticatingLayout,
  },
]

export default SignIn
