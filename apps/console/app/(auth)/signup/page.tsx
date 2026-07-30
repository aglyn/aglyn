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
  updateProfile,
  type UserCredential,
} from 'firebase/auth'
import { doc, setDoc, type Firestore } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import {
  useAnalytics,
  useAuth,
  useFirestore,
  useSigninCheck,
} from '@aglyn/tenant-feature-instance'
import AuthErrorAlertComponent from '../../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../../components/auth-form-template.component'
import AuthFormComponent from '../../../components/auth-form.component'
import { AuthConsentCheckbox } from '../../../components/auth-legal-consent.component'
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

/**
 * Keep the name this form REQUIRES (AGL-1127).
 *
 * Both fields are `isRequired`, so no one gets an account without typing
 * them — and nothing was done with either. Sign-up created the auth user from
 * the email and password and dropped the rest on the floor, leaving the
 * account with no `displayName` and no `users/{uid}` profile doc at all. The
 * user then opened Manage Account → Basic info, found the name they had just
 * been made to enter blank, and had to type it a second time.
 *
 * Both destinations matter: rosters, comments and the app bar read the auth
 * `displayName`, while the profile doc is what Basic info edits. Best-effort
 * on purpose — the account exists and the user is signed in by this point, so
 * a failed prefill must not surface as a failed sign-up. The session-cookie
 * route re-seeds the profile from `displayName` on the next sign-in anyway.
 */
async function persistSignUpProfile(
  firestore: Firestore,
  credential: UserCredential,
  values: Record<string, unknown>,
): Promise<void> {
  const firstName = String(values[FIELD_SCHEMA_FIRST_NAME.name] ?? '').trim()
  const lastName = String(values[FIELD_SCHEMA_LAST_NAME.name] ?? '').trim()
  if (!firstName && !lastName) return
  try {
    await Promise.all([
      setDoc(
        doc(firestore, 'users', credential.user.uid),
        { firstName, lastName },
        { merge: true },
      ),
      updateProfile(credential.user, {
        displayName: [firstName, lastName].filter(Boolean).join(' '),
      }),
    ])
  } catch (error) {
    console.error('sign-up profile write failed', error)
  }
}

function SignUp() {
  const { queueLoading, loading } = useLoading()
  const firebaseAuth = useAuth()
  const firestore = useFirestore()
  const [error, setError] = useState<AuthResultError>(null)
  // Account creation is contract formation, so both sign-up flows (email and
  // Google) require affirmative agreement to the Terms and Privacy Policy.
  const [consented, setConsented] = useState(false)
  const [consentError, setConsentError] = useState(false)
  const analytics = useAnalytics()
  // Org workspace subdomains can't run OAuth — hand sign-in to the auth
  // host and skip the local form/redirect-result entirely (AGL-465).
  const delegation = useDelegateWorkspaceSignIn('signup')
  // Mobile browsers sign in via redirect (AGL-462); this completes the
  // round-trip when Google sends the user back here.
  useGoogleRedirectResult('sign_up', setError, delegation === 'off')
  // Hold the loading splash during the post-auth redirect window instead of
  // flashing the form back at the user (AGL-476).
  const { data: signInCheckResult } = useSigninCheck()
  const signedIn = signInCheckResult?.signedIn === true

  const handleSignUp = useCallback(
    async (values?: any) => {
      if (loading) return
      // Gate both the email/password submit and the Google button on consent.
      if (!consented) {
        setConsentError(true)
        return
      }
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
        .then(async (credential) => {
          logEvent(analytics, 'sign_up', {
            method: credential.providerId,
          })
          // Only the email/password branch has form values to keep; the
          // Google branches carry their name on the token, and the session
          // route seeds from that (AGL-1127).
          if (values) {
            await persistSignUpProfile(firestore, credential, values)
          }
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
    [
      analytics,
      consented,
      error,
      firebaseAuth,
      firestore,
      loading,
      queueLoading,
    ],
  )

  const handleConsentChange = useCallback((next: boolean) => {
    setConsented(next)
    if (next) setConsentError(false)
  }, [])

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
  if (signedIn) {
    // Authenticated — the layout is about to route away. Hold the loading
    // screen so the form doesn't flash back (AGL-476).
    return (
      <AuthFormComponent
        headingTop={'Signing in'}
        headingBottom={'One moment'}
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
      <AuthConsentCheckbox
        checked={consented}
        onChange={handleConsentChange}
        error={consentError}
      />
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
