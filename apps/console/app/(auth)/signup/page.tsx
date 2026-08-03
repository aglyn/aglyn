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

import {
  PLAN_LABELS,
  generateOrgSlug,
  onboardingDestination,
  parseOnboardingPlanIntent,
} from '@aglyn/aglyn'
import type { AuthResultError } from '@aglyn/shared-data-enums'
import {
  FIELD_SCHEMA_EMAIL,
  FIELD_SCHEMA_FIRST_NAME,
  FIELD_SCHEMA_LAST_NAME,
  FIELD_SCHEMA_ORGANIZATION_NAME,
  FIELD_SCHEMA_PASSWORD,
  FIELD_SCHEMA_PASSWORD_CONFIRM,
} from '@aglyn/shared-data-forms'
import { useSearchParams } from 'next/navigation'
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
import { useCallback, useMemo, useState } from 'react'
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

/**
 * The org name has to survive becoming a workspace address (AGL-1115).
 *
 * `/api/orgs/create` derives the slug with `generateOrgSlug` and rejects the
 * request when nothing usable is left — reserved words like "workspace",
 * "admin" or "api", anything under two characters, and names that are all
 * punctuation or emoji. `provisionSignUpOrg` is best-effort, so that 400 was
 * swallowed and the person landed on the workspace picker having typed a name
 * and been given nothing, with no idea why.
 *
 * Checked here rather than on the shared field: Manage Account collects the
 * same "organization name" as free text about the person's employer, and it
 * never becomes a subdomain. Only signup has this constraint.
 */
const signupOrgNameField = {
  ...FIELD_SCHEMA_ORGANIZATION_NAME,
  helperText: 'This becomes your workspace address, e.g. acme-inc.aglyn.com',
  validate: [
    ...(FIELD_SCHEMA_ORGANIZATION_NAME.validate ?? []),
    (value: unknown) =>
      !String(value ?? '').trim() || generateOrgSlug(String(value ?? ''))
        ? undefined
        : 'Pick a different name — this one can’t be used as a workspace ' +
          'address. Try adding a word, and avoid reserved names like ' +
          '“admin” or “workspace”.',
  ],
} as typeof FIELD_SCHEMA_ORGANIZATION_NAME

const formSchema: FormSchema = {
  fields: [
    FIELD_SCHEMA_FIRST_NAME,
    FIELD_SCHEMA_LAST_NAME,
    // Collected here so a new account lands in a ready workspace instead of
    // an empty chooser (AGL-1115). It is the org's display name; the slug is
    // derived server-side by `/api/orgs/create`, so nobody has to think about
    // URLs while signing up.
    signupOrgNameField,
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

/**
 * Provision the workspace the user just named, and say where to land them
 * (AGL-1115 / AGL-1117).
 *
 * Best-effort by contract, like the profile write above it: the account
 * exists and the user is signed in by this point, so a failed org create must
 * not surface as a failed sign-up. It returns `null` and the caller falls
 * back to the workspace picker — which is exactly where signup used to land
 * everyone, so the worst case is the old behaviour.
 */
async function provisionSignUpOrg(
  credential: UserCredential,
  orgName: string,
): Promise<string | null> {
  const name = orgName.trim()
  if (!name) return null
  try {
    const idToken = await credential.user.getIdToken()
    const response = await fetch('/api/orgs/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ name }),
    })
    const payload = await response.json().catch(() => null)
    // A 409 means the slug was taken — the org was NOT created, so falling
    // through to the picker is right; inventing a suffix here would hand the
    // user a workspace URL they never chose.
    if (!response.ok) {
      console.error('sign-up org create failed', payload?.error)
      return null
    }
    return typeof payload?.slug === 'string' ? payload.slug : null
  } catch (error) {
    console.error('sign-up org create failed', error)
    return null
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
  // The plan a visitor picked on the marketing pricing page (AGL-1117):
  // `/signup?plan=pro&interval=year`. Parsed once and defensively — the
  // contract is with a site we cannot deploy in lockstep with, so a bad
  // param degrades to ordinary signup rather than breaking it.
  const searchParams = useSearchParams()
  const planIntent = useMemo(
    () => parseOnboardingPlanIntent(searchParams),
    [searchParams],
  )
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
          // A Google sign-up has no form, so it never had a workspace name
          // and used to land on the picker with the plan intent discarded
          // (AGL-1117). Someone who clicked "Get Pro" and then "Sign up with
          // Google" got no plan, no workspace, and a chooser.
          //
          // Only when a plan was actually picked. Without one, the picker is
          // still the right landing: naming a workspace after somebody who
          // never asked for one is a worse default than letting them choose.
          // With one, they have told us what they came to do, and stranding
          // them costs the sale.
          //
          // The name is derived the same way `ensureOrgForUser` derives it
          // server-side — display name, else the email local part — so the
          // two paths cannot disagree about what a personal workspace is
          // called. It is renameable afterwards.
          if (!values && planIntent) {
            const derived =
              credential.user.displayName?.trim() ||
              credential.user.email?.split('@')[0]?.trim() ||
              ''
            const slug = derived
              ? await provisionSignUpOrg(credential, derived)
              : null
            if (slug) {
              window.location.assign(onboardingDestination(slug, planIntent))
              return
            }
          }
          // Only the email/password branch has form values to keep; the
          // Google branches carry their name on the token, and the session
          // route seeds from that (AGL-1127).
          if (values) {
            await persistSignUpProfile(firestore, credential, values)
            // Provision the workspace and land in it (AGL-1115), carrying the
            // plan the visitor picked on the marketing site (AGL-1117).
            //
            // Only the email/password branch: the Google buttons submit no
            // form, so there is no org name to create one from. Those still
            // land on the workspace picker, unchanged — collecting a name
            // from them needs the two-step flow AGL-1115 also suggests, and
            // that is a bigger change than this.
            const slug = await provisionSignUpOrg(
              credential,
              String(values[FIELD_SCHEMA_ORGANIZATION_NAME.name] ?? ''),
            )
            if (slug) {
              // A hard navigation on purpose: the org is brand new, so the
              // whole chrome (switcher, plan badge, nav) has to resolve
              // against it rather than re-using the pre-signup tree.
              window.location.assign(onboardingDestination(slug, planIntent))
            }
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
      planIntent,
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
        headingAfter={<CircularProgress color="primary" />}
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
        headingAfter={<CircularProgress color="primary" />}
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
      headingBottom={
        // Say which plan they picked (AGL-1117). The deep link carried it all
        // the way to checkout already, but the form said nothing — so someone
        // who clicked "Get Pro, billed yearly" on the pricing page landed on a
        // generic "Create a new Aglyn Account" with no sign their choice had
        // survived the click. Cheap to doubt, and expensive to doubt on the
        // one page where abandoning costs a sale.
        planIntent
          ? planIntent.contactSales
            ? `Create your account — we’ll get you set up on ${PLAN_LABELS[planIntent.plan]}`
            : `Create your account to start on ${PLAN_LABELS[planIntent.plan]}, billed ${
                planIntent.interval === 'year' ? 'yearly' : 'monthly'
              }`
          : 'Create a new Aglyn Account'
      }
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
