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

import {
  FIELD_SCHEMA_EMAIL,
  FIELD_SCHEMA_FIRST_NAME,
  FIELD_SCHEMA_LAST_NAME,
  FIELD_SCHEMA_PASSWORD,
  FIELD_SCHEMA_PASSWORD_CONFIRM,
} from '@aglyn/shared-data-fields'
import {
  AglynSvgIcon,
  AglynSvgLogo,
  AppLink,
  componentMapper,
  FormRenderer,
} from '@aglyn/shared-ui-jsx'
import {mdiGoogle, MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import type FormSchema from '@data-driven-forms/react-form-renderer/common-types/schema'
import {type OAuthCredential, UserCredential} from '@firebase/auth'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import {type FormApi, type SubmissionErrors} from 'final-form'
import {
  AuthError,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth'
import {useCallback, useState} from 'react'
import AuthBaseComponent from '../components/auth-base.component'
import AuthBasicFormComponent from '../components/auth-basic-form.component'
import {getFirebaseAuth, googleOAuthProvider} from '../lib/firebase/firebase-app'


const firebaseAuth = getFirebaseAuth()

type ResultError = AuthError & {credential?: OAuthCredential}
type ResultUser = UserCredential & {credential?: OAuthCredential}
type ResultAuth = Promise<UserCredential>

const formSchema: FormSchema = {
  'fields': [
    FIELD_SCHEMA_FIRST_NAME,
    FIELD_SCHEMA_LAST_NAME,
    FIELD_SCHEMA_EMAIL,
    FIELD_SCHEMA_PASSWORD,
    FIELD_SCHEMA_PASSWORD_CONFIRM,
  ],
}
const defaultValues = {firstName: '', lastName: '', email: '', Passwd: '', ConfirmPasswd: ''}

function Signup() {

  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<ResultUser>(null)
  const [error, setError] = useState<ResultError>(null)


  const handleGoogleOAuthSignUp = useCallback((): ResultAuth => {
    return signInWithPopup(firebaseAuth, googleOAuthProvider)
  }, [])

  const handlePasswordSignUp = useCallback((email: string, password: string): ResultAuth => {
    return createUserWithEmailAndPassword(firebaseAuth, email, password)
  }, [])

  const handleSignUp = useCallback(async (email?: any, password?: string) => {
    if (loading) return
    setLoading(true)
    const result: ResultAuth = email && password
      ? handlePasswordSignUp(email, password)
      : handleGoogleOAuthSignUp()

    await result
      .then((result) => {
        setUser({...result, credential: GoogleAuthProvider.credentialFromResult(result)})
        if (error) setError(null)
      })
      .catch((error) => {
        setError({...error, credential: GoogleAuthProvider.credentialFromError(error)})
      })

    setLoading(false)
  }, [loading, handleGoogleOAuthSignUp, handlePasswordSignUp, error])

  const handleFormSubmit = useCallback(async (
    values,
    formApi: FormApi,
    onError: (errors?: SubmissionErrors) => void,
  ) => {
    await handleSignUp(values.email, values.Passwd)
  }, [handleSignUp])

  const handleGoogleButtonClick = useCallback(async () => {
    await handleSignUp()
  }, [handleSignUp])


  return (
    <>

      <Paper
        elevation={1}
        sx={{
          p: 2,
          zIndex: 5,
          width: 440,
          maxWidth: 1,
        }}
      >

        {`Loading: ${loading}`}
        <br />
        <br />
        {`Error: ${JSON.stringify(error, null, 2)}`}
        <br />
        <br />
        {`User: ${JSON.stringify(user, null, 2)}`}
        <br />
        <br />

        <Stack
          direction="column"
          justifyContent="center"
          alignItems="center"
          spacing={1}
          sx={{mb: 4}}
        >

          <Typography
            component="div"
            variant="body2"
            alignSelf="flex-end"
          >
            <AppLink
              href="/signin"
            >
              {'Sign in'}
            </AppLink>
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


          <Typography
            component="h1"
            variant="h4"
          >
            {'Sign up'}
          </Typography>

          <Typography
            component="div"
            variant="h6"
          >
            {'Create a new Aglyn Account'}
          </Typography>
        </Stack>

        <FormRenderer
          FormTemplate={AuthBasicFormComponent}
          componentMapper={componentMapper}
          onSubmit={handleFormSubmit}
          initialValues={defaultValues}
          schema={formSchema}
          subscription={{values: true}}

          clearOnUnmount
        />

        {error ? (
          <Alert
            sx={{my: 1}}
            severity="error"
          >
            <Typography
              component="div"
              variant="body1"
            >
              <strong>ERROR: </strong>
              {error.message}
            </Typography>
            <Typography
              component="div"
              variant="caption"
              color="textSecondary"
              children={error.code}
            />
          </Alert>
        ) : null}

        <Divider flexItem sx={{my: 1}}>
          {'Or'}
        </Divider>

        <Stack
          direction="column"
          justifyContent="center"
          alignItems="stretch"
          spacing={1}
        >

          <Button
            startIcon={<MdiIcon path={mdiGoogle.path} />}
            onClick={handleGoogleButtonClick}
          >
            {'Sign up with Google'}
          </Button>

        </Stack>

      </Paper>

      <Typography
        component="div"
        variant="body2"
        color=""
      >
        {'Already have an account? '}
        <AppLink
          href="/signin"
        >
          Sign in
        </AppLink>
      </Typography>


    </>
  )
}
Signup.displayName = 'Page:Signup'
Signup.getLayout = (children) => <AuthBaseComponent children={children} />

export default Signup
