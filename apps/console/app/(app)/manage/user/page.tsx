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
import { Avatar, Box, Button, Stack, TextField } from '@mui/material'
import { logEvent } from 'firebase/analytics'
import {
  signInWithEmailAndPassword,
  updatePassword,
  updateProfile,
} from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useAnalytics, useAuth, useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import CardDisplayFormTemplate from '../../../../components/card-display-form-template'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import manageNavTabItems from '../../../../constants/manage-nav-tabs'
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

const ManageUser: NextPageWithLayout<Record<string, never>> = (props) => {
  const [tab, setTab] = useState('basic')
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

  const handleBasicSave = useCallback(
    async (fields: any) => {
      const dequeueLoading = queueLoading()
      await setDoc(userRef, { ...fields }, { merge: true })
        .then(() => {
          enqueueSnackbar('Saved!', { variant: 'success' })
        })
        .catch((e) => {
          enqueueSnackbar(`Error: ${JSON.stringify(e)}`, { variant: 'error' })
        })
        .finally(() => {
          dequeueLoading()
        })
    },
    [enqueueSnackbar, queueLoading, userRef],
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

  const forms = [
    {
      schema: basicSchema,
      initialValues: data,
      onSubmit: handleBasicSave,
    },
    {
      schema: securitySchema,
      onSubmit: handleSecuritySave,
    },
  ]

  const onTabChange = useCallback(
    async (e, value) => {
      setTab(value)
      const form = forms.find(({ schema }) => schema.id === value)
      logEvent(analytics, 'screen_view', {
        firebase_screen: form.schema.title as string,
        firebase_screen_class: ManageUser.displayName,
      })
    },
    [forms, analytics],
  )

  return (
    <>
      <NextPageTitle screen={'Settings'} />
      <DashboardLayout
        navTabItems={manageNavTabItems()}
        activeTab={buildRoute(Route.MANAGE_USER_SETTINGS)}
        breadcrumbItems={[
          {
            children: 'Settings',
            href: buildRoute(Route.MANAGE_USER_SETTINGS),
          },
        ]}
        help="account"
        header={{
          children: 'Account',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {/* Profile image (AGL-365). */}
          <CardDisplay
            header={'Profile image'}
            help={docsHelp('account', {
              excerpt:
                'Your personal avatar across the console — the app bar, ' +
                'comments, and team lists.',
            })}
            contentGutterX
            contentGutterY
            sx={{ mb: 3 }}
          >
            <Stack
              direction="row"
              spacing={2}
              sx={{ alignItems: 'center', maxWidth: 560 }}
            >
              <Avatar src={photoUrl || undefined} sx={{ width: 56, height: 56 }}>
                {(user?.displayName || user?.email || '?')
                  .slice(0, 1)
                  .toUpperCase()}
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
          <TabContext value={tab}>
            <GridItems
              spacing={3}
              items={[
                {
                  size: {
                    xs: 12,
                    sm: 3,
                  },
                  children: (
                    <CardDisplay
                      header="Navigation"
                      help={docsHelp('account', {
                        excerpt:
                          'Sections of your personal account settings — ' +
                          'basic info and password.',
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
                        {forms.map(({ schema }) => (
                          <Tab
                            key={schema.id}
                            value={schema.id}
                            label={schema.title}
                          />
                        ))}
                      </TabList>
                    </CardDisplay>
                  ),
                },
                {
                  size: {
                    xs: 12,
                    sm: 9,
                  },
                  children: (
                    <>
                      {forms.map(({ initialValues, onSubmit, schema }) => (
                        <TabPanel
                          key={schema.id}
                          value={schema.id}
                          sx={{ padding: 'unset' }}
                        >
                          <FormRenderer
                            FormTemplate={CardDisplayFormTemplate}
                            componentMapper={simpleComponentMapper}
                            onSubmit={onSubmit}
                            schema={schema}
                            subscription={{ values: true }}
                            initialValues={initialValues}
                          />
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
