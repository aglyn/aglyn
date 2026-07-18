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
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useHost } from '@aglyn/tenant-feature-instance'
import { TabContext, TabList, TabPanel } from '@mui/lab'
import { InputAdornment, Tab } from '@mui/material'
import { logEvent } from 'firebase/analytics'
import { useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useAnalytics, useUser } from '@aglyn/tenant-feature-instance'
import HostActivityTable from '../../../../components/host-activity-table.component'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import CardDisplayFormTemplate from '../../../../components/card-display-form-template'
import { useHostId } from '../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import PluginWidgetSlot from '../../../../components/plugin-widget-slot.component'
import MainLayout from '../../../../components/layouts/main.layout'
import CustomDomainCard from '../../../../components/custom-domain-card.component'
import FaviconCard from '../../../../components/favicon-card.component'
import ErrorScreensCard from '../../../../components/error-screens-card.component'
import LanguagesCard from '../../../../components/languages-card.component'
import SiteBackupCard from '../../../../components/site-backup-card.component'
import SiteTemplateCard from '../../../../components/site-template-card.component'
import DeleteSiteCard from '../../../../components/delete-site-card.component'
import ThemeEditor from '../../../../components/theme-editor/theme-editor.component'
import HostDisplayNameComponent from '../../../../components/host-display-name.component'
import { buildRoute, Route } from '../../../../constants/route-links'
import hostNavTabItems from '../../../../constants/host-nav-tabs'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useHostActivityLogger from '../../../../hooks/use-host-activity-logger'

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
      name: 'analytics.gaMeasurementId',
      label: 'Google Analytics measurement ID',
      helperText: 'Optional — e.g. G-XXXXXXXXXX; injects gtag on your site',
      type: 'text',
      FormFieldGridProps: {
        size: {
          xs: 12,
          sm: 6,
        },
      },
    },
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

/** Theme tab id (AGL-114); `/setup?tab=theme` deep links land here. */
const THEME_TAB_ID = 'theme'
/** Custom domain tab id (AGL-122); `/setup?tab=domain` deep links. */
const DOMAIN_TAB_ID = 'domain'
/** Activity tab id (AGL-249); `/setup?tab=activity` deep links. */
const ACTIVITY_TAB_ID = 'activity'

const HostSetup: NextPageWithLayout<Record<string, never>> = (props) => {
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()

  const searchParams = useSearchParams()
  const requestedTab = searchParams?.get('tab')
  const [tab, setTab] = useState(
    requestedTab === THEME_TAB_ID ||
      requestedTab === DOMAIN_TAB_ID ||
      requestedTab === ACTIVITY_TAB_ID ||
      requestedTab === seoSchema.id
      ? requestedTab
      : basicSchema.id,
  )
  const analytics = useAnalytics()
  const { data: user } = useUser()
  const hostId = useHostId()
  const {
    doc: { data, status },
    setDoc,
  } = useHost({ hostId })
  const [themeSaving, setThemeSaving] = useState(false)
  const logActivity = useHostActivityLogger(hostId)

  const handleThemeSave = useCallback(
    async (theme: Aglyn.AglynHostTheme) => {
      setThemeSaving(true)
      const dequeueLoading = queueLoading()
      // mergeFields replaces the theme atomically, so cleared colors do not
      // linger from a deep merge with the previous document.
      await setDoc({ theme }, { mergeFields: ['theme'] })
        .then(() => {
          enqueueSnackbar('Theme saved!', { variant: 'success' })
          logActivity('Updated theme', { type: 'theme' })
        })
        .catch((e) => {
          enqueueSnackbar(`Error: ${JSON.stringify(e)}`, { variant: 'error' })
        })
        .finally(() => {
          dequeueLoading()
          setThemeSaving(false)
        })
    },
    [enqueueSnackbar, queueLoading, setDoc, logActivity],
  )

  const handleBasicSave = useCallback(
    async (fields: any) => {
      const dequeueLoading = queueLoading()
      // Rename guards (AGL-147): the create API validates new hosts, but
      // this save path could silently rename onto a taken or blocked
      // subdomain — run the same server checks first.
      const subdomainChanged =
        typeof fields.subdomain === 'string' &&
        fields.subdomain !== data?.subdomain
      const displayNameChanged =
        typeof fields.displayName === 'string' &&
        fields.displayName !== data?.displayName
      if (subdomainChanged || displayNameChanged) {
        try {
          const idToken = await (user as any)?.getIdToken?.()
          const response = await fetch('/api/hosts/validate-name', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({
              hostId,
              ...(subdomainChanged && { subdomain: fields.subdomain }),
              ...(displayNameChanged && { displayName: fields.displayName }),
            }),
          })
          const validation = response.ok ? await response.json() : null
          if (validation) {
            if (
              !validation.subdomainValid ||
              validation.subdomainBlocked ||
              validation.subdomainTaken
            ) {
              dequeueLoading()
              const hint = validation.suggestions?.length
                ? ` Try: ${validation.suggestions.join(', ')}`
                : ''
              return void enqueueSnackbar(
                (validation.subdomainTaken
                  ? 'That subdomain is taken.'
                  : 'That subdomain is not available.') + hint,
                { variant: 'warning', persist: false },
              )
            }
            if (validation.displayNameCollision) {
              enqueueSnackbar(
                'Another of your sites already uses this name — saved ' +
                  'anyway, but consider renaming one.',
                { variant: 'info', persist: false },
              )
            }
          }
        } catch {
          // Validation is advisory on network failure; the save proceeds.
        }
      }
      await setDoc(fields, { merge: true })
        .then(() => {
          enqueueSnackbar('Saved!', { variant: 'success' })
          logActivity('Updated host settings', { type: 'host', id: hostId })
        })
        .catch((e) => {
          enqueueSnackbar(`Error: ${JSON.stringify(e)}`, { variant: 'error' })
        })
        .finally(() => {
          dequeueLoading()
        })
    },
    [enqueueSnackbar, queueLoading, setDoc, hostId, logActivity, data, user],
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
        firebase_screen: (form?.schema.title as string) ?? 'Theme',
        firebase_screen_class: HostSetup.displayName,
      })
    },
    [forms, analytics],
  )

  return (
    <>
      <NextPageTitle screen={'Host Setup'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(hostId)}
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
                        <Tab value={THEME_TAB_ID} label={'Theme'} />
                        <Tab value={DOMAIN_TAB_ID} label={'Custom Domain'} />
                        <Tab value={ACTIVITY_TAB_ID} label={'Activity'} />
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

                          {schema.id === 'hostDetails' ? (
                            <>
                              <div style={{ marginTop: 24 }}>
                                <ErrorScreensCard hostId={hostId} />
                              </div>
                              <div style={{ marginTop: 24 }}>
                                <LanguagesCard hostId={hostId} />
                              </div>
                              <div style={{ marginTop: 24 }}>
                                <SiteBackupCard hostId={hostId} />
                              </div>
                              <div style={{ marginTop: 24 }}>
                                <SiteTemplateCard hostId={hostId} />
                              </div>
                              <div style={{ marginTop: 24 }}>
                                <DeleteSiteCard hostId={hostId} />
                              </div>
                            </>
                          ) : null}
                          {schema.id === 'hostSeo' ? (
                            <div style={{ marginTop: 24 }}>
                              <FaviconCard hostId={hostId} />
                            </div>
                          ) : null}
                        </TabPanel>
                      ))}
                      <TabPanel value={THEME_TAB_ID} sx={{ padding: 'unset' }}>
                        {status === 'success' ? (
                          <ThemeEditor
                            theme={data?.theme}
                            saving={themeSaving}
                            onSave={handleThemeSave}
                          />
                        ) : null}
                      </TabPanel>
                      <TabPanel value={DOMAIN_TAB_ID} sx={{ padding: 'unset' }}>
                        <CustomDomainCard hostId={hostId} />
                      </TabPanel>
                      <TabPanel
                        value={ACTIVITY_TAB_ID}
                        sx={{ padding: 'unset' }}
                      >
                        <HostActivityTable hostId={hostId} />
                      </TabPanel>
                    </>
                  ),
                },
              ]}
            />
          </TabContext>
          {/* Plugin zone (AGL-433): hostSettings widgets. */}
          <PluginWidgetSlot slot="hostSettings" hostId={hostId} />
        </Container>
      </DashboardLayout>
    </>
  )
}
HostSetup.displayName = 'Page:HostSetup'

export default HostSetup
