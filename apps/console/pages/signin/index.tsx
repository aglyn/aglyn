/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import type {AuthResultError} from '@aglyn/shared-data-enums'
import {FIELD_SCHEMA_EMAIL, FIELD_SCHEMA_PASSWORD} from '@aglyn/shared-data-forms'
import {AppLink, useLoading} from '@aglyn/shared-ui-jsx'
import type {FormSchema} from '@aglyn/shared-ui-jsx-forms'
import {FormRenderer, simpleComponentMapper} from '@aglyn/shared-ui-jsx-forms'
import {mdiGoogle, MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {useNextPageTitle} from '@aglyn/shared-ui-next'
import {Button, Divider, Stack, Typography} from '@mui/material'
import {logEvent} from 'firebase/analytics'
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth'
import {useCallback, useState} from 'react'
import {useAnalytics, useAuth} from 'reactfire'
import AuthErrorAlertComponent from '../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../components/auth-form-template.component'
import AuthFormComponent from '../../components/auth-form.component'
import UnauthenticatedLayout from '../../components/layouts/unauthenticated.layout'


const googleOAuthProvider = new GoogleAuthProvider()

const formSchema: FormSchema = {
  fields: [FIELD_SCHEMA_EMAIL, FIELD_SCHEMA_PASSWORD],
}

function SignIn() {
  useNextPageTitle({screen: 'Sign out'})
  const {queueLoading, loading} = useLoading()
  const firebaseAuth = useAuth()
  const [error, setError] = useState<AuthResultError>(null)
  const analytics = useAnalytics()

  const handleSignIn = useCallback(async (values?: any) => {
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
        setError({...error, credential: GoogleAuthProvider.credentialFromError(error)})
      })
      .finally(() => {
        dequeueLoading()
      })
  }, [error, firebaseAuth, loading, queueLoading])

  const handleFormSubmit = useCallback(async (values) => {
    await handleSignIn(values)
  }, [handleSignIn])
  const handleGoogleButtonClick = useCallback(async () => {
    await handleSignIn()
  }, [handleSignIn])

  return (
    <AuthFormComponent
      paperTop={
        <Typography
          component="div"
          variant="body2"
          alignSelf="flex-end"
        >
          <AppLink href="/signup">
            {'Create account'}
          </AppLink>
        </Typography>
      }
      headingTop={'Sign in'}
      headingBottom={'Use your Aglyn account'}
      paperAfter={
        <Typography
          component="div"
          variant="body2"
        >
          {'Having trouble logging in? '}
          <AppLink href="/account-recovery">
            {'Account recovery'}
          </AppLink>
        </Typography>
      }
    >
      <FormRenderer
        FormTemplate={AuthFormTemplateComponent}
        componentMapper={simpleComponentMapper}
        onSubmit={handleFormSubmit}
        schema={formSchema}
        subscription={{values: true}}
        clearOnUnmount
      />
      <AuthErrorAlertComponent
        error={error as any}
        sx={{mt: 2, mb: 1}}
      />

      <Divider
        flexItem
        variant="middle"
        sx={{my: 3}}
      >
        {'Or sign in with'}
      </Divider>

      <Stack
        direction="column"
        justifyContent="center"
        alignItems="stretch"
        spacing={1}
        paddingBottom={2}
      >
        <Button
          variant="outlined"
          startIcon={<MdiIcon path={mdiGoogle.path} />}
          onClick={handleGoogleButtonClick}
        >
          {'Google'}
        </Button>
      </Stack>
    </AuthFormComponent>
  )
}
SignIn.displayName = 'Page:SignIn'
SignIn.layouts = [UnauthenticatedLayout]

export default SignIn
