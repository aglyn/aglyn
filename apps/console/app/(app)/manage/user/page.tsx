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
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { TabContext, TabList, TabPanel } from '@mui/lab'
import { Tab } from '@mui/material'
import {
  Avatar,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
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
  }, [user, refreshProviders, enqueueSnackbar])

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

        {/* Connect / disconnect sign-in providers (AGL-860). */}
        <Box>
          <Typography variant="subtitle2">{'Sign-in methods'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {'How you sign in to Aglyn. Add another for a backup way in, or ' +
              'remove one you no longer use — keep at least one.'}
          </Typography>
        </Box>
        <Stack spacing={1}>
          {providerIds.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No sign-in methods found.'}
            </Typography>
          ) : (
            providerIds.map((id) => {
              const canRemove = providerIds.length > 1
              return (
                <Stack
                  key={id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                    {PROVIDER_LABELS[id] ?? id}
                  </Typography>
                  <Button
                    size="small"
                    color="error"
                    disabled={linkBusy || !canRemove}
                    onClick={() => void disconnectProvider(id, canRemove)}
                  >
                    {'Disconnect'}
                  </Button>
                </Stack>
              )
            })
          )}
        </Stack>
        {!providerIds.includes('google.com') ? (
          <Button
            size="small"
            variant="outlined"
            disabled={linkBusy}
            onClick={() => void connectGoogle()}
            sx={{ alignSelf: 'flex-start' }}
          >
            {'Connect Google'}
          </Button>
        ) : null}
        {!hasPassword ? (
          <Typography variant="caption" color="text.secondary">
            {'You sign in with ' +
              (providerIds
                .map((id) => PROVIDER_LABELS[id] ?? id)
                .join(', ') || 'a linked provider') +
              ' — there is no password to change here.'}
          </Typography>
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
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: 'center', maxWidth: 560 }}
      >
        <Avatar src={photoUrl || undefined} sx={{ width: 56, height: 56 }}>
          {(user?.displayName || user?.email || '?').slice(0, 1).toUpperCase()}
        </Avatar>
        <Box sx={{ flex: 1 }}>
          <MediaUrlField
            label="Image URL"
            helperText="Browse the org media library or paste an https URL"
            orgId={currentOrg?.$id ?? null}
            value={photoUrl}
            onChange={setPhotoUrl}
          />
        </Box>
        <Button variant="outlined" onClick={() => void handlePhotoSave()}>
          {'Save'}
        </Button>
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
    <>
      <NextPageTitle screen={'Manage Account'} />
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
    </>
  )
}
ManageUser.displayName = 'Page:ManageUser'

export default ManageUser
