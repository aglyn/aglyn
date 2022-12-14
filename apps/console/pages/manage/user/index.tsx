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

import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import {
  FIELD_SCHEMA_FIRST_NAME,
  FIELD_SCHEMA_LAST_NAME,
  FIELD_SCHEMA_PASSWORD,
  FIELD_SCHEMA_PASSWORD_CONFIRM,
  FIELD_SCHEMA_PASSWORD_OLD,
} from '@aglyn/shared-data-forms'
import { Container, GridItems, useLoading } from '@aglyn/shared-ui-jsx'
import {
  FormRenderer,
  FormSchema,
  FormSpy,
  FormTemplateRenderProps,
  simpleComponentMapper,
  useFormApi,
} from '@aglyn/shared-ui-jsx-forms'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { TabContext, TabList, TabPanel } from '@mui/lab'
import { Button, FormControl, Grid, Tab } from '@mui/material'
import { logEvent } from 'firebase/analytics'
import { signInWithEmailAndPassword, updatePassword } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { forwardRef, useCallback, useState } from 'react'
import {
  useAnalytics,
  useAuth,
  useFirestore,
  useFirestoreDocData,
  useUser,
} from 'reactfire'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import WidgetCardComponent from '../../../components/widget-card.component'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

const basicSchema: FormSchema = {
  id: 'basic',
  title: 'Basic info',
  fields: [FIELD_SCHEMA_FIRST_NAME, FIELD_SCHEMA_LAST_NAME],
}
const securitySchema: FormSchema = {
  id: 'security',
  title: 'Security',
  fields: [
    FIELD_SCHEMA_PASSWORD_OLD,
    FIELD_SCHEMA_PASSWORD,
    FIELD_SCHEMA_PASSWORD_CONFIRM,
  ],
}

const FormTemplate = forwardRef<any, FormTemplateRenderProps>((props, ref) => {
  const { formFields, schema, ...rest } = props
  const { handleSubmit } = useFormApi()
  const isLoading = status === 'loading'
  return (
    <WidgetCardComponent
      contentGutterY
      contentGutterX
      header={schema.title}
      actions={
        <FormSpy>
          {({ submitting, pristine, valid }) => (
            <FormControl margin="normal">
              <Button
                color="secondary"
                disabled={submitting || pristine || !valid || isLoading}
                // style={{ marginRight: 8 }}
                type="submit"
                // variant="contained"
              >
                Update
              </Button>
            </FormControl>
          )}
        </FormSpy>
      }
    >
      <form ref={ref} onSubmit={handleSubmit} noValidate {...rest}>
        <Grid spacing={2} container>
          {formFields as any}
        </Grid>
      </form>
    </WidgetCardComponent>
  )
})
FormTemplate.displayName = 'FormTemplate'

const ManageUser: NextPageWithLayout = (props) => {
  const [tab, setTab] = useState('basic')
  const { data: user } = useUser()
  const userRef = doc(useFirestore(), 'users', user.uid)
  const { data } = useFirestoreDocData(userRef)
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
        navTabItems={[
          {
            id: 'nav-tab-settings-user',
            label: 'User',
            href: buildRoute(Route.MANAGE_USER_SETTINGS),
          },
          {
            id: 'nav-tab-settings-account',
            label: 'Account',
            href: buildRoute(Route.MANAGE_ACCOUNT_SETTINGS),
          },
        ]}
        breadcrumbItems={[
          {
            children: 'Settings',
            href: buildRoute(Route.MANAGE_ACCOUNT_SETTINGS),
          },
        ]}
        header={{
          children: 'Account',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <TabContext value={tab}>
            <GridItems
              spacing={3}
              items={[
                {
                  xs: 12,
                  sm: 3,
                  children: (
                    <WidgetCardComponent header="Navigation">
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
                    </WidgetCardComponent>
                  ),
                },
                {
                  xs: 12,
                  sm: 9,
                  children: (
                    <>
                      {forms.map(({ initialValues, onSubmit, schema }) => (
                        <TabPanel
                          key={schema.id}
                          value={schema.id}
                          sx={{ padding: 'unset' }}
                        >
                          <FormRenderer
                            FormTemplate={FormTemplate}
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
ManageUser.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'User Manage',
    },
  },
]

export default ManageUser
