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
import { useNextPageTitle } from '@aglyn/shared-ui-next'
import { Button, Divider, Stack, Typography } from '@mui/material'
import { logEvent } from 'firebase/analytics'
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  setPersistence,
  signInWithPopup,
} from 'firebase/auth'
import { useCallback, useState } from 'react'
import { useAnalytics, useAuth } from 'reactfire'
import AuthErrorAlertComponent from '../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../components/auth-form-template.component'
import AuthFormComponent from '../../components/auth-form.component'
import AuthenticatingLayout from '../../components/layouts/authenticating.layout'

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

  const handleSignUp = useCallback(
    async (values?: any) => {
      if (loading) return
      if (error) setError(null)
      const dequeueLoading = queueLoading()
      await setPersistence(firebaseAuth, browserLocalPersistence)
        .then(() => {
          if (values) {
            return createUserWithEmailAndPassword(
              firebaseAuth,
              values[FIELD_SCHEMA_EMAIL.name],
              values[FIELD_SCHEMA_PASSWORD.name],
            )
          }
          return signInWithPopup(firebaseAuth, googleOAuthProvider)
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
SignUp.layouts = [
  {
    Component: AuthenticatingLayout,
  },
]

export default SignUp
