/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import { canLinkSocialProvider } from '@aglyn/aglyn'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import {
  FIELD_SCHEMA_FIRST_NAME,
  FIELD_SCHEMA_LAST_NAME,
  FIELD_SCHEMA_ORGANIZATION_NAME,
  FIELD_SCHEMA_PASSWORD,
  FIELD_SCHEMA_PASSWORD_CONFIRM,
  FIELD_SCHEMA_PASSWORD_OLD,
  FIELD_SCHEMA_PHONE_NUMBER,
} from '@aglyn/shared-data-forms'
import { Container, GridItems, useLoading } from '@aglyn/shared-ui-jsx'
import {
  FormRenderer,
  FormSchema,
  simpleComponentMapper,
} from '@aglyn/shared-ui-jsx-forms'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { TabContext, TabList, TabPanel } from '@mui/lab'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  Tab,
  TextField,
  Typography,
} from '@mui/material'
import { mdiLockOutline } from '@aglyn/shared-data-mdi'
import { logEvent } from 'firebase/analytics'
import {
  GoogleAuthProvider,
  linkWithPopup,
  signInWithEmailAndPassword,
  unlink,
  updatePassword,
  updateProfile,
} from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAnalytics, useAuth, useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import CardDisplayFormTemplate from '../../../../components/card-display-form-template'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import MediaUrlField from '../../../../components/media-url-field.component'
import { useOrgScope } from '../../../../hooks/use-org-scope'
import useFirestoreDoc from '../../../../hooks/use-firestore-doc'

const basicSchema: FormSchema = {
  id: 'basic',
  title: 'Basic info',
  CardDisplayProps: {
    help: docsHelp('account', {
      excerpt:
        'Your name and contact details, stored on your personal console ' +
        'account and shown to teammates.',
    }),
  },
  fields: [
    FIELD_SCHEMA_FIRST_NAME,
    FIELD_SCHEMA_LAST_NAME,
    FIELD_SCHEMA_PHONE_NUMBER,
    FIELD_SCHEMA_ORGANIZATION_NAME,
  ],
}
const securitySchema: FormSchema = {
  id: 'security',
  title: 'Security',
  CardDisplayProps: {
    help: docsHelp('account', {
      anchor: '#resetting-your-password',
      excerpt:
        'Change your console password by confirming the current one first.',
    }),
  },
  fields: [
    FIELD_SCHEMA_PASSWORD_OLD,
    FIELD_SCHEMA_PASSWORD,
    FIELD_SCHEMA_PASSWORD_CONFIRM,
  ],
}

// Firebase providerId → a name a person recognizes (AGL-852).
const PROVIDER_LABELS: Record<string, string> = {
  password: 'Email & password',
  'google.com': 'Google',
  'apple.com': 'Apple',
  'github.com': 'GitHub',
  'microsoft.com': 'Microsoft',
}

/** Official multicolor Google "G" (AGL-873), for the branded sign-in row/button. */
function GoogleGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

const ManageUser: NextPageWithLayout<Record<string, never>> = (props) => {
  const [tab, setTab] = useState('account')
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { currentOrg } = useOrgScope()
  const userRef = doc(firestore, 'users', user.uid)
  const { data } = useFirestoreDoc(
    () => userRef,
    [firestore, user.uid],
  )
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const firebaseAuth = useAuth()
  const analytics = useAnalytics()

  // Which providers this account signs in with (AGL-852). Drives the email/
  // provider card and hides the change-password form for an account that has
  // no password to change (e.g. Google-only), which otherwise threw.
  const providerIds = (
    (user?.providerData ?? []) as Array<{ providerId?: string }>
  )
    .map((info) => info?.providerId)
    .filter((id): id is string => Boolean(id))
  const hasPassword = providerIds.includes('password')
  /**
   * Whether this account is governed by enterprise SSO (AGL-1128) — i.e. it
   * lives in an org's GCIP tenant pool rather than the project pool.
   *
   * SSO-governed accounts may NOT link a consumer provider. The customer's
   * IdP is the single gate they bought: they revoke there, enforce MFA there,
   * offboard there. A linked personal Google account is a way in that their
   * IdP cannot see or revoke — precisely what SSO is purchased to prevent.
   *
   * This is deliberately NOT gated on `sso.enforced`. That flag exists so we
   * never LOCK OUT an existing sign-in method; it is not a licence to hand out
   * new bypasses in the meantime. Nothing here removes an existing provider,
   * so no one can be locked out by it.
   *
   * The hard boundary is upstream: a GCIP tenant only accepts providers
   * enabled on that tenant, and the SSO tenants have none besides their SAML
   * provider — so linking would fail server-side regardless. This keeps us
   * from OFFERING an action that is both broken and, if it ever worked, a
   * security regression.
   */
  const ssoGoverned = !canLinkSocialProvider(
    user as { tenantId?: string | null },
  )

  const handleBasicSave = useCallback(
    async (fields: any) => {
      const dequeueLoading = queueLoading()
      try {
        await setDoc(userRef, { ...fields }, { merge: true })
        // Keep Firebase Auth's displayName in step (AGL-852): rosters and
        // comments read it, so without this a name edit here was invisible to
        // teammates. Best-effort — a failed sync must not fail the save.
        const displayName = [
          String(fields?.[FIELD_SCHEMA_FIRST_NAME.name] ?? '').trim(),
          String(fields?.[FIELD_SCHEMA_LAST_NAME.name] ?? '').trim(),
        ]
          .filter(Boolean)
          .join(' ')
        if (displayName && displayName !== user?.displayName) {
          try {
            await updateProfile(user, { displayName })
          } catch (error) {
            console.error('displayName sync failed', error)
          }
        }
        enqueueSnackbar('Saved!', { variant: 'success' })
      } catch (e) {
        enqueueSnackbar(`Error: ${JSON.stringify(e)}`, { variant: 'error' })
      } finally {
        dequeueLoading()
      }
    },
    [enqueueSnackbar, queueLoading, userRef, user],
  )
  // Profile image (AGL-365): mirrors to the auth photoURL (app bar,
  // comments) and the users doc (team lists, activity).
  const [photoUrl, setPhotoUrl] = useState('')
  useEffect(() => {
    setPhotoUrl(String((data as any)?.photoUrl ?? user?.photoURL ?? ''))
  }, [(data as any)?.photoUrl, user?.photoURL])
  const handlePhotoSave = useCallback(async () => {
    const cleaned = photoUrl.trim()
    if (cleaned && !/^https:\/\//i.test(cleaned)) {
      return void enqueueSnackbar('Image URLs must be https://', {
        variant: 'warning',
        persist: false,
      })
    }
    const dequeueLoading = queueLoading()
    try {
      await setDoc(userRef, { photoUrl: cleaned }, { merge: true })
      await updateProfile(user, { photoURL: cleaned || null })
      enqueueSnackbar('Profile image saved', { variant: 'success' })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Saving the image failed', { variant: 'error' })
    } finally {
      dequeueLoading()
    }
  }, [photoUrl, userRef, user, queueLoading, enqueueSnackbar])

  const handleSecuritySave = useCallback(
    async (fields: any) => {
      const dequeueLoading = queueLoading()
      await signInWithEmailAndPassword(
        firebaseAuth,
        user.email,
        fields[FIELD_SCHEMA_PASSWORD_OLD.name],
      )
        .then(() => {
          return updatePassword(user, fields[FIELD_SCHEMA_PASSWORD.name])
        })
        .catch((e) => {
          enqueueSnackbar(`Error: ${JSON.stringify(e)}`, { variant: 'error' })
        })
        .finally(() => {
          dequeueLoading()
        })
    },
    [enqueueSnackbar, firebaseAuth, queueLoading, user],
  )

  // Connect/disconnect sign-in providers (AGL-860). link/unlink mutate the
  // User in place; bump a tick after reload() so `providerData` re-reads.
  const [linkBusy, setLinkBusy] = useState(false)
  const [, setProvidersTick] = useState(0)
  const refreshProviders = useCallback(async () => {
    try {
      await user.reload()
    } catch (error) {
      console.error('user reload failed', error)
    }
    setProvidersTick((tick) => tick + 1)
  }, [user])

  const connectGoogle = useCallback(async () => {
    // Refuse in the handler too, not just by hiding the button (AGL-1128).
    // Hiding a control is a UI decision; this is the intent, and it survives
    // a stale render. The real boundary is the tenant's provider config —
    // GCIP will reject a provider the tenant does not enable — but an
    // SSO bypass should never depend on a remote config staying right.
    if (ssoGoverned) {
      enqueueSnackbar(
        'Your organization signs in through its own identity provider — ' +
          'other sign-in methods cannot be connected.',
        { variant: 'warning' },
      )
      return
    }
    setLinkBusy(true)
    try {
      await linkWithPopup(user, new GoogleAuthProvider())
      await refreshProviders()
      enqueueSnackbar('Google connected', { variant: 'success' })
    } catch (error: any) {
      const code = error?.code as string | undefined
      // A closed/duplicated popup is a normal cancel — say nothing.
      if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request'
      ) {
        return
      }
      enqueueSnackbar(
        code === 'auth/credential-already-in-use' ||
          code === 'auth/email-already-in-use' ||
          code === 'auth/provider-already-linked'
          ? 'That Google account is already linked to an Aglyn account.'
          : 'Connecting Google failed',
        { variant: 'warning' },
      )
    } finally {
      setLinkBusy(false)
    }
  }, [user, refreshProviders, enqueueSnackbar, ssoGoverned])

  const disconnectProvider = useCallback(
    async (providerId: string, canRemove: boolean) => {
      if (!canRemove) {
        enqueueSnackbar("You can't remove your only sign-in method.", {
          variant: 'warning',
          persist: false,
        })
        return
      }
      setLinkBusy(true)
      try {
        await unlink(user, providerId)
        await refreshProviders()
        enqueueSnackbar(
          `${PROVIDER_LABELS[providerId] ?? providerId} disconnected`,
          { variant: 'success' },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Disconnecting failed', { variant: 'error' })
      } finally {
        setLinkBusy(false)
      }
    },
    [user, refreshProviders, enqueueSnackbar],
  )

  // Account email & sign-in (AGL-852), now a tab (AGL-859).
  const accountCard: ReactNode = (
    <CardDisplay
      header={'Account'}
      help={docsHelp('account', {
        excerpt:
          'The email you sign in with and the providers linked to your ' +
          'account.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2.5} sx={{ maxWidth: 560 }}>
        <TextField
          label="Email"
          value={user?.email ?? ''}
          size="small"
          fullWidth
          slotProps={{ input: { readOnly: true } }}
          helperText="Set by your sign-in provider — change it there, not here."
        />
        <Chip
          size="small"
          variant="outlined"
          color={user?.emailVerified ? 'success' : 'warning'}
          label={user?.emailVerified ? 'Email verified' : 'Email unverified'}
          sx={{ alignSelf: 'flex-start' }}
        />

        {/* Sign-in methods (AGL-860, redesigned AGL-873). Email & password is
            the account baseline and is never disconnectable. */}
        <Box>
          <Typography variant="subtitle2">{'Sign-in methods'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {ssoGoverned
              ? 'How you sign in to Aglyn, managed by your organization.'
              : 'How you sign in to Aglyn. Connect another for a backup way in.'}
          </Typography>
        </Box>
        {providerIds.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No sign-in methods found.'}
          </Typography>
        ) : (
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            {providerIds.map((id, index) => {
              const isGoogle = id === 'google.com'
              const isPassword = id === 'password'
              // Password is the account baseline — never removable. An OAuth
              // provider is removable only when it isn't the last method left.
              const canRemove =
                !isPassword && providerIds.filter((p) => p !== id).length > 0
              const sub = isGoogle
                ? (user?.email ?? 'Connected')
                : isPassword
                  ? 'Sign in with your email and password'
                  : 'Connected'
              return (
                <Box key={id}>
                  {index > 0 ? <Divider /> : null}
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: 'center', px: 2, py: 1.5 }}
                  >
                    <Box
                      sx={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        bgcolor: isGoogle ? 'common.white' : 'action.hover',
                        border: isGoogle ? '1px solid' : 'none',
                        borderColor: 'divider',
                      }}
                    >
                      {isGoogle ? (
                        <GoogleGlyph />
                      ) : (
                        <MdiIcon
                          path={mdiLockOutline.path}
                          fontSize="small"
                          sx={{ color: 'text.secondary' }}
                        />
                      )}
                    </Box>
                    <Stack sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {PROVIDER_LABELS[id] ?? id}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                      >
                        {sub}
                      </Typography>
                    </Stack>
                    {isPassword ? (
                      <Chip size="small" variant="outlined" label="Required" />
                    ) : (
                      <Button
                        size="small"
                        color="error"
                        disabled={linkBusy || !canRemove}
                        onClick={() => void disconnectProvider(id, canRemove)}
                      >
                        {'Disconnect'}
                      </Button>
                    )}
                  </Stack>
                </Box>
              )
            })}
          </Box>
        )}
        {ssoGoverned ? (
          <Alert severity="info" sx={{ alignSelf: 'stretch' }}>
            {'Your organization signs in through its own identity provider. ' +
              'Other sign-in methods are disabled so that access stays ' +
              'governed there — including when it is revoked.'}
          </Alert>
        ) : null}
        {!ssoGoverned && !providerIds.includes('google.com') ? (
          <Button
            variant="outlined"
            startIcon={<GoogleGlyph />}
            disabled={linkBusy}
            onClick={() => void connectGoogle()}
            sx={(theme) => ({
              alignSelf: 'flex-start',
              textTransform: 'none',
              fontWeight: 500,
              px: 2,
              py: 0.75,
              color: theme.palette.mode === 'dark' ? '#e3e3e3' : '#3c4043',
              backgroundColor:
                theme.palette.mode === 'dark' ? '#131314' : '#fff',
              borderColor:
                theme.palette.mode === 'dark' ? '#5f6368' : '#dadce0',
              '&:hover': {
                backgroundColor:
                  theme.palette.mode === 'dark' ? '#1f1f20' : '#f8f9fa',
                borderColor:
                  theme.palette.mode === 'dark' ? '#5f6368' : '#dadce0',
              },
            })}
          >
            {'Continue with Google'}
          </Button>
        ) : null}
      </Stack>
    </CardDisplay>
  )

  // Profile image (AGL-365), now a tab (AGL-859).
  const profileCard: ReactNode = (
    <CardDisplay
      header={'Profile image'}
      help={docsHelp('account', {
        excerpt:
          'Your personal avatar across the console — the app bar, ' +
          'comments, and team lists.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2.5} sx={{ maxWidth: 560 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Avatar
            src={photoUrl || undefined}
            sx={{
              width: 72,
              height: 72,
              fontSize: 28,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            {(user?.displayName || user?.email || '?').slice(0, 1).toUpperCase()}
          </Avatar>
          <Stack spacing={0.25}>
            <Typography variant="subtitle2">{'Your avatar'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {'Shown across the console — the app bar, comments, and team ' +
                'lists.'}
            </Typography>
          </Stack>
        </Stack>
        <MediaUrlField
          label="Image URL"
          helperText="Browse the org media library or paste an https URL"
          orgId={currentOrg?.$id ?? null}
          value={photoUrl}
          onChange={setPhotoUrl}
        />
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            color="secondary"
            onClick={() => void handlePhotoSave()}
          >
            {'Save'}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )

  const formPanel = (schema: FormSchema, onSubmit: (fields: any) => void) => (
    <FormRenderer
      FormTemplate={CardDisplayFormTemplate}
      componentMapper={simpleComponentMapper}
      onSubmit={onSubmit}
      schema={schema}
      subscription={{ values: true }}
      initialValues={schema.id === 'basic' ? data : undefined}
    />
  )

  // Every account area is a tab now (AGL-859) — the standalone Account and
  // Profile cards moved into the nav. Security only when there's a password
  // to change (AGL-852).
  const sections: Array<{ id: string; label: string; content: ReactNode }> = [
    { id: 'account', label: 'Account', content: accountCard },
    { id: 'profile', label: 'Profile image', content: profileCard },
    { id: 'basic', label: 'Basic info', content: formPanel(basicSchema, handleBasicSave) },
    ...(hasPassword
      ? [
          {
            id: 'security',
            label: 'Security',
            content: formPanel(securitySchema, handleSecuritySave),
          },
        ]
      : []),
  ]

  const onTabChange = useCallback(
    async (_event: unknown, value: string) => {
      setTab(value)
      const section = sections.find((entry) => entry.id === value)
      logEvent(analytics, 'screen_view', {
        firebase_screen: section?.label ?? value,
        firebase_screen_class: ManageUser.displayName,
      })
    },
    [sections, analytics],
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Manage Account',
          href: buildRoute(Route.MANAGE_USER_SETTINGS),
        },
      ]}
      help="account"
      header={{
        children: 'Manage Account',
        icon: { path: ICON_VARIANT_APP_SETTINGS.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <TabContext value={tab}>
          <GridItems
            spacing={3}
            items={[
              {
                size: { xs: 12, sm: 3 },
                children: (
                  <CardDisplay
                    header="Navigation"
                    help={docsHelp('account', {
                      excerpt:
                        'Sections of your account — sign-in, profile ' +
                        'image, basic info and password.',
                    })}
                  >
                    <TabList
                      orientation="vertical"
                      textColor="secondary"
                      indicatorColor="secondary"
                      sx={{
                        ['.MuiTab-root']: {
                          alignItems: 'start',
                          maxWidth: 'unset',
                        },
                      }}
                      onChange={onTabChange}
                    >
                      {sections.map((section) => (
                        <Tab
                          key={section.id}
                          value={section.id}
                          label={section.label}
                        />
                      ))}
                    </TabList>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, sm: 9 },
                children: (
                  <>
                    {sections.map((section) => (
                      <TabPanel
                        key={section.id}
                        value={section.id}
                        sx={{ padding: 'unset' }}
                      >
                        {section.content}
                      </TabPanel>
                    ))}
                  </>
                ),
              },
            ]}
          />
        </TabContext>
      </Container>
    </DashboardLayout>
  )
}
ManageUser.displayName = 'Page:ManageUser'

export default ManageUser
