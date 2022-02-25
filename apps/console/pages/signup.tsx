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

import type {AuthCallbackResult, AuthResultError, AuthResultUser} from '@aglyn/shared-data-enums'
import {
  FIELD_SCHEMA_EMAIL,
  FIELD_SCHEMA_FIRST_NAME,
  FIELD_SCHEMA_LAST_NAME,
  FIELD_SCHEMA_PASSWORD,
  FIELD_SCHEMA_PASSWORD_CONFIRM,
} from '@aglyn/shared-data-forms'
import {getFirebaseAuth, googleOAuthProvider} from '@aglyn/shared-feature-fbclient'
import {AglynSvgIcon, AglynSvgLogo, AppLink, useLoading} from '@aglyn/shared-ui-jsx'
import type {FormSchema} from '@aglyn/shared-ui-jsx-forms'
import {FormRenderer, simpleComponentMapper} from '@aglyn/shared-ui-jsx-forms'
import {mdiGoogle, MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {useContinueQueryDecoded} from '@aglyn/shared-util-next'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type {FormApi, SubmissionErrors} from 'final-form'
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  setPersistence,
  signInWithPopup,
} from 'firebase/auth'
import {useRouter} from 'next/router'
import {useCallback, useState} from 'react'
import AuthFormTemplateComponent from '../components/auth-form-template.component'
import LayoutRequestAuthenticationComponent
  from '../layouts/layout-request-authentication.component'


const firebaseAuth = getFirebaseAuth()

const formSchema: FormSchema = {
  fields: [
    FIELD_SCHEMA_FIRST_NAME,
    FIELD_SCHEMA_LAST_NAME,
    FIELD_SCHEMA_EMAIL,
    FIELD_SCHEMA_PASSWORD,
    FIELD_SCHEMA_PASSWORD_CONFIRM,
  ],
}
const defaultValues = {
  [FIELD_SCHEMA_FIRST_NAME.name]: '',
  [FIELD_SCHEMA_LAST_NAME.name]: '',
  [FIELD_SCHEMA_EMAIL.name]: '',
  [FIELD_SCHEMA_PASSWORD.name]: '',
  [FIELD_SCHEMA_PASSWORD_CONFIRM.name]: '',
}

function Signup() {
  const router = useRouter()
  const [{href, hrefAs}] = useContinueQueryDecoded()
  const {queueLoading, loading} = useLoading()
  const [user, setUser] = useState<AuthResultUser>(null)
  const [error, setError] = useState<AuthResultError>(null)

  const handleRedirect = useCallback(async () => {
    return await (href
        ? router.push(href, hrefAs || '')
        : router.push('/')
    )
  }, [href, hrefAs, router])

  const handleGoogleOAuthSignUp = useCallback((): AuthCallbackResult => {
    return signInWithPopup(firebaseAuth, googleOAuthProvider)
  }, [])

  const handlePasswordSignUp = useCallback(
    (email: string, password: string): AuthCallbackResult => {
      return createUserWithEmailAndPassword(firebaseAuth, email, password)
    },
    [],
  )

  const handleSignUp = useCallback(
    async (values?: any) => {
      if (error) setError(null)
      if (loading) return
      const dequeueLoading = queueLoading()

      await setPersistence(firebaseAuth, browserLocalPersistence)
        .then(() => {
          return values
            ? handlePasswordSignUp(values.email, values.Passwd)
            : handleGoogleOAuthSignUp()
        })
        .then((result) => {
          setUser({...result, credential: GoogleAuthProvider.credentialFromResult(result)})
          return handleRedirect()
        })
        .then(() => {
          dequeueLoading()
        })
        .catch((error) => {
          setError({...error, credential: GoogleAuthProvider.credentialFromError(error)})
          dequeueLoading()
        })
    },
    [error, loading, queueLoading, handlePasswordSignUp, handleGoogleOAuthSignUp, handleRedirect],
  )

  const handleFormSubmit = useCallback(
    async (values, formApi: FormApi, onError: (errors?: SubmissionErrors) => void) => {
      await handleSignUp(values)
    },
    [handleSignUp],
  )

  const handleGoogleButtonClick = useCallback(async () => {
    await handleSignUp()
  }, [handleSignUp])

  return (
    <>
      <Stack direction="column" justifyContent="center" alignItems="center" spacing={2}>
        <Paper
          elevation={1}
          sx={{
            p: 2,
            zIndex: 5,
            width: 440,
            maxWidth: 1,
          }}
        >
          <Stack
            direction="column"
            justifyContent="center"
            alignItems="center"
            spacing={1}
            sx={{mb: 4}}
          >
            <Typography component="div" variant="body2" alignSelf="flex-end">
              <AppLink href="/signin">{'Sign in'}</AppLink>
            </Typography>

            <Stack
              direction="row"
              justifyContent="center"
              alignItems="center"
              spacing={1}
              sx={{pb: 3}}
            >
              <AglynSvgIcon rounded bordered sx={{fontSize: 24}} />
              <AglynSvgLogo sx={{fontSize: 64, transform: `translateY(0.12rem)`}} />
            </Stack>

            <Typography component="h1" variant="h4">
              {'Sign up'}
            </Typography>

            <Typography component="div" variant="h6">
              {'Create a new Aglyn Account'}
            </Typography>
          </Stack>

          <FormRenderer
            FormTemplate={AuthFormTemplateComponent}
            componentMapper={simpleComponentMapper}
            onSubmit={handleFormSubmit}
            initialValues={defaultValues}
            schema={formSchema}
            subscription={{values: true}}
            clearOnUnmount
          />

          <Divider flexItem sx={{my: 1}}>
            {'Or'}
          </Divider>

          <Stack direction="column" justifyContent="center" alignItems="stretch" spacing={1}>
            <Button startIcon={<MdiIcon path={mdiGoogle.path} />} onClick={handleGoogleButtonClick}>
              {'Sign up with Google'}
            </Button>
          </Stack>

          <br />
          <br />
          {`Loading: ${loading}`}
          <br />
          <br />
          {`Error: ${JSON.stringify(error, null, 2)}`}
          <br />
          <br />
          {`User: ${JSON.stringify(user, null, 2)}`}
          <br />
          <br />
        </Paper>

        <Typography component="div" variant="body2">
          {'Already have an account? '}
          <AppLink href="/signin">Sign in</AppLink>
        </Typography>
      </Stack>
    </>
  )
}
Signup.displayName = 'Page:Signup'
Signup.layoutComponent = LayoutRequestAuthenticationComponent

export default Signup
