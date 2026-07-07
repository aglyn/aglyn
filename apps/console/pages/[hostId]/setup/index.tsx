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

import * as Aglyn from '@aglyn/aglyn'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { Container, GridItems, useLoading } from '@aglyn/shared-ui-jsx'
import {
  FieldComponentType,
  FieldValidatorType,
  FormRenderer,
  FormSchema,
  simpleComponentMapper,
} from '@aglyn/shared-ui-jsx-forms'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useHost } from '@aglyn/tenant-feature-instance'
import { TabContext, TabList, TabPanel } from '@mui/lab'
import { InputAdornment, Tab } from '@mui/material'
import { logEvent } from 'firebase/analytics'
import { doc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useAnalytics, useFirestore } from 'reactfire'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import CardDisplayFormTemplate from '../../../components/card-display-form-template'
import { useHostId } from '../../../components/host-id-provider'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import HostDisplayNameComponent from '../../../components/host-display-name.component'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

const basicSchema: FormSchema = {
  id: 'hostDetails',
  title: 'Basic details',
  fields: [
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'displayName',
      label: 'Display name',
      type: 'text',
      FormFieldGridProps: {
        size: {
          xs: 12,
          sm: 6,
        },
      },
      isRequired: true,
      validate: [
        {
          type: FieldValidatorType.REQUIRED,
          message: 'Please enter a display name',
        },
        {
          type: FieldValidatorType.MAX_LENGTH,
          threshold: 30,
          message: 'Please enter shorter display name',
        },
      ],
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'subdomain',
      label: 'Subdomain',
      type: 'text',
      isRequired: true,
      validate: [
        {
          type: FieldValidatorType.REQUIRED,
          message: 'Please enter a subdomain',
        },
        {
          type: FieldValidatorType.MAX_LENGTH,
          threshold: 15,
          message: 'Please enter shorter display name',
        },
      ],
    },
  ],
}

const seoSchema: FormSchema = {
  id: 'hostSeo',
  title: 'SEO',
  fields: [
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'seo.title',
      label: 'Title',
      type: 'text',
      isRequired: true,
      resolveProps: (_, { input: { value } }) => {
        const len = value?.length || 0
        const over = len > 60
        return {
          InputProps: {
            endAdornment: (
              <InputAdornment
                position="end"
                sx={{ color: over ? 'error.light' : undefined }}
              >
                {len}/60
              </InputAdornment>
            ),
          },
        }
      },
      validate: [
        {
          type: FieldValidatorType.REQUIRED,
          message: 'Please enter a title',
        },
        {
          type: FieldValidatorType.MAX_LENGTH,
          threshold: 60,
          message: 'Please enter a shorter title',
        },
      ],
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'seo.description',
      label: 'Description',
      type: 'text',
      isRequired: true,
      multiline: true,
      rows: 2,
      resolveProps: (_, { input: { value } }) => {
        const len = value?.length || 0
        const over = len > 155
        return {
          InputProps: {
            endAdornment: (
              <InputAdornment
                position="end"
                sx={{ color: over ? 'error.light' : undefined }}
              >
                {len}/155
              </InputAdornment>
            ),
          },
        }
      },
      validate: [
        {
          type: FieldValidatorType.REQUIRED,
          message: 'Please enter a description',
        },
        {
          type: FieldValidatorType.MAX_LENGTH,
          threshold: 155,
          message: 'Please enter a shorter description',
        },
      ],
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'seo.separator',
      label: 'Separator',
      type: 'text',
      isRequired: true,
      validate: [
        {
          type: FieldValidatorType.REQUIRED,
          message: 'Please enter a title separator',
        },
        {
          type: FieldValidatorType.MAX_LENGTH,
          threshold: 3,
          message: 'Please enter a shorter title separator',
        },
      ],
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'seo.favicon',
      label: 'Favicon',
      type: 'text',
    },
    {
      component: FieldComponentType.SUB_FORM,
      name: 'seo.entity',
      title: 'Entity',
      className: false,
      fields: [
        {
          component: FieldComponentType.SELECT,
          name: 'seo.entity.type',
          label: 'Type',
          options: [
            {
              value: `${Aglyn.HostEntityType.ORGANIZATION}`,
              label: 'Organization',
            },
            { value: `${Aglyn.HostEntityType.PERSON}`, label: 'Person' },
          ],
        },
        {
          component: FieldComponentType.TEXT_FIELD,
          name: 'seo.entity.name',
          label: 'Name',
        },
        {
          component: FieldComponentType.TEXT_FIELD,
          name: 'seo.entity.logo',
          label: 'Logo',
        },
      ],
    },
  ],
}

const useHostRef = (id: Aglyn.HostUid) => {
  const firestore = useFirestore()
  return doc(firestore, 'hosts', id)
}

const HostSetup: NextPageWithLayout = (props) => {
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()

  const [tab, setTab] = useState(basicSchema.id)
  const analytics = useAnalytics()
  const hostId = useHostId()
  const {
    doc: { data },
    setDoc,
  } = useHost({ hostId })

  const handleBasicSave = useCallback(
    async (fields: any) => {
      const dequeueLoading = queueLoading()
      await setDoc(fields, { merge: true })
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
    [enqueueSnackbar, queueLoading, setDoc],
  )

  const forms = [
    {
      schema: basicSchema,
      initialValues: data,
      onSubmit: handleBasicSave,
    },
    {
      schema: seoSchema,
      initialValues: data,
      onSubmit: handleBasicSave,
    },
  ]

  const onTabChange = useCallback(
    async (e, value) => {
      setTab(value)
      const form = forms.find(({ schema }) => schema.id === value)
      logEvent(analytics, 'screen_view', {
        firebase_screen: form.schema.title as string,
        firebase_screen_class: HostSetup.displayName,
      })
    },
    [forms, analytics],
  )

  return (
    <>
      <NextPageTitle screen={'Host Setup'} />
      <DashboardLayout
        navTabItems={[
          {
            id: 'nav-tab-dashboard',
            label: 'Dashboard',
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            id: 'nav-tab-screens',
            label: 'Screens',
            href: buildRoute(Route.SCREEN_LIST, { hostId }),
          },
          {
            id: 'nav-tab-layouts',
            label: 'Layouts',
            href: buildRoute(Route.LAYOUT_LIST, { hostId }),
          },
          {
            id: 'nav-tab-theme',
            label: 'Theme',
            href: buildRoute(Route.HOST_THEME, { hostId }),
          },
          {
            id: 'nav-tab-media',
            label: 'Media',
            href: buildRoute(Route.HOST_MEDIA, { hostId }),
          },
          {
            id: 'nav-tab-inbox',
            label: 'Inbox',
            href: buildRoute(Route.HOST_INBOX, { hostId }),
          },
          {
            id: 'nav-tab-setup',
            label: 'Setup',
            href: buildRoute(Route.HOST_SETUP, { hostId }),
          },
        ]}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            children: 'Setup',
            href: buildRoute(Route.HOST_SETUP, { hostId }),
          },
        ]}
        header={{
          children: 'Host Setup',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
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
                    <CardDisplay header="Navigation">
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
                            initialValues={initialValues}
                          />

                          <CardDisplay></CardDisplay>
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
HostSetup.displayName = 'Page:HostSetup'
HostSetup.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Host Setup',
    },
  },
]

export default HostSetup
