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
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useAnalytics, useUser } from '@aglyn/tenant-feature-instance'
import HostActivityTable from '../../../../../../components/host-activity-table.component'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import CardDisplayFormTemplate from '../../../../../../components/card-display-form-template'
import { useHostId, useHostSubdomain } from '../../../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import PluginWidgetSlot from '../../../../../../components/plugin-widget-slot.component'
import MainLayout from '../../../../../../components/layouts/main.layout'
import AuthScreensCard from '../../../../../../components/auth-screens-card.component'
import CustomDomainCard from '../../../../../../components/custom-domain-card.component'
import SiteEmailsCard from '../../../../../../components/site-emails-card.component'
import FaviconCard from '../../../../../../components/favicon-card.component'
import LogoCard from '../../../../../../components/logo-card.component'
import ErrorScreensCard from '../../../../../../components/error-screens-card.component'
import LanguagesCard from '../../../../../../components/languages-card.component'
import SiteBackupCard from '../../../../../../components/site-backup-card.component'
import SiteTemplateCard from '../../../../../../components/site-template-card.component'
import DeleteSiteCard from '../../../../../../components/delete-site-card.component'
import ThemeEditor from '../../../../../../components/theme-editor/theme-editor.component'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import { docsHelp } from '../../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'
import useHostActivityLogger from '../../../../../../hooks/use-host-activity-logger'

const basicSchema: FormSchema = {
  id: 'hostDetails',
  title: 'Basic details',
  CardDisplayProps: {
    help: docsHelp('gettingStarted', {
      anchor: '#what-a-site-contains',
      excerpt:
        'The site name shown across the console and the subdomain it is ' +
        'served from.',
    }),
  },
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
      help: docsHelp('gettingStarted', {
        anchor: '#create-your-first-site',
        excerpt:
          "Your site's address on aglyn.app — you can also connect your " +
          'own domain from the Custom Domain tab.',
      }),
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
  CardDisplayProps: {
    help: docsHelp('seo', {
      excerpt:
        'Site-wide defaults for titles, descriptions, and structured ' +
        'data — screens can override them in their own SEO editor.',
    }),
  },
  fields: [
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'analytics.gaMeasurementId',
      label: 'Google Analytics measurement ID',
      helperText: 'Optional — e.g. G-XXXXXXXXXX; injects gtag on your site',
      help: docsHelp('analytics', {
        anchor: '#google-analytics',
        excerpt:
          'Track your site in Google Analytics alongside the built-in ' +
          'pageview analytics.',
      }),
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
      help: docsHelp('seo', {
        anchor: '#per-screen-seo',
        excerpt:
          'Default title emitted in the page head and browser tab — ' +
          'screens without their own SEO title fall back to it.',
      }),
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
      help: docsHelp('seo', {
        anchor: '#per-screen-seo',
        excerpt:
          'Default meta description shown under your site in search ' +
          'results when a screen sets none of its own.',
      }),
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
      help: docsHelp('seo', {
        excerpt:
          'Character placed between a screen title and the site title ' +
          'in the browser tab, e.g. "|" or "·".',
      }),
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
      help: docsHelp('seo', {
        anchor: '#structured-data',
        excerpt:
          'Who publishes this site — emitted as JSON-LD structured data ' +
          'so search engines show rich results.',
      }),
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
/** Emails reference tab id (AGL-769); `/setup?tab=emails` deep links here. */
const EMAILS_TAB_ID = 'emails'

const HostSetup: NextPageWithLayout<Record<string, never>> = (props) => {
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()

  const searchParams = useSearchParams()
  const requestedTab = searchParams?.get('tab')
  const [tab, setTab] = useState(
    requestedTab === THEME_TAB_ID ||
      requestedTab === DOMAIN_TAB_ID ||
      requestedTab === ACTIVITY_TAB_ID ||
      requestedTab === EMAILS_TAB_ID ||
      requestedTab === seoSchema.id
      ? requestedTab
      : basicSchema.id,
  )
  const analytics = useAnalytics()
  const { data: user } = useUser()
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const router = useRouter()
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
      const subdomainChanged =
        typeof fields.subdomain === 'string' &&
        fields.subdomain !== data?.subdomain
      const displayNameChanged =
        typeof fields.displayName === 'string' &&
        fields.displayName !== data?.displayName
      const idToken = await (user as any)?.getIdToken?.()

      // A duplicate display name is allowed, so this check stays advisory.
      if (displayNameChanged) {
        try {
          const response = await fetch('/api/hosts/validate-name', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({ hostId, displayName: fields.displayName }),
          })
          const validation = response.ok ? await response.json() : null
          if (validation?.displayNameCollision) {
            enqueueSnackbar(
              'Another of your sites already uses this name — saved ' +
                'anyway, but consider renaming one.',
              { variant: 'info', persist: false },
            )
          }
        } catch {
          // Advisory on network failure; the save proceeds.
        }
      }

      // The subdomain is the site's public address, so the server owns it
      // (AGL-642) — it revalidates and claims uniqueness transactionally
      // with the Admin SDK. This used to be a client write guarded only by
      // an advisory check, which meant the pattern/reserved/uniqueness rules
      // could be skipped entirely. The rules now reject a client write, so a
      // failure here has to abort rather than fall through to setDoc.
      let renamedTo: string | null = null
      if (subdomainChanged) {
        try {
          const response = await fetch('/api/hosts/rename', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({ hostId, subdomain: fields.subdomain }),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok) {
            dequeueLoading()
            const hint = payload?.suggestions?.length
              ? ` Try: ${payload.suggestions.join(', ')}`
              : ''
            return void enqueueSnackbar(
              (payload?.error ?? 'Could not change the subdomain.') + hint,
              { variant: 'warning', persist: false },
            )
          }
          renamedTo = String(payload?.subdomain ?? fields.subdomain)
        } catch {
          dequeueLoading()
          return void enqueueSnackbar(
            'Could not reach the server to change the subdomain.',
            { variant: 'error' },
          )
        }
      }

      // `subdomain` is server-owned above; the rules reject it from here.
      const clientFields = { ...fields }
      delete clientFields.subdomain
      await setDoc(clientFields, { merge: true })
        .then(() => {
          enqueueSnackbar('Saved!', { variant: 'success' })
          logActivity('Updated host settings', { type: 'host', id: hostId })
          // The subdomain addresses this page, so a rename leaves the
          // current URL pointing at nothing — the host guard would render
          // the designed 404 on a successful save. Follow it across.
          if (renamedTo && renamedTo !== host) {
            router.replace(
              buildRoute(Route.HOST_SETUP, { orgSlug, host: renamedTo }),
            )
          }
        })
        .catch((e) => {
          enqueueSnackbar(`Error: ${JSON.stringify(e)}`, { variant: 'error' })
        })
        .finally(() => {
          dequeueLoading()
        })
    },
    [
      enqueueSnackbar,
      queueLoading,
      setDoc,
      hostId,
      logActivity,
      data,
      user,
      router,
      orgSlug,
      host,
    ],
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
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug,  host }),
          },
          {
            children: 'Setup',
            href: buildRoute(Route.HOST_SETUP, { orgSlug,  host }),
          },
        ]}
        help="gettingStarted"
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
                    <CardDisplay
                      header="Navigation"
                      help={docsHelp('consoleTour', {
                        excerpt:
                          "Jump between this site's setup sections — " +
                          'details, SEO, theme, custom domain, and activity.',
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
                        <Tab value={THEME_TAB_ID} label={'Theme'} />
                        <Tab value={DOMAIN_TAB_ID} label={'Custom Domain'} />
                        <Tab value={EMAILS_TAB_ID} label={'Emails'} />
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
                              {/* Site brand mark (AGL-594): shown by the
                                  tenant's navigation loader. */}
                              <div style={{ marginTop: 24 }}>
                                <LogoCard hostId={hostId} />
                              </div>
                              <div style={{ marginTop: 24 }}>
                                <ErrorScreensCard hostId={hostId} />
                              </div>
                              {/* Designable auth screens (AGL-553). */}
                              <div style={{ marginTop: 24 }}>
                                <AuthScreensCard hostId={hostId} />
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
                      <TabPanel value={EMAILS_TAB_ID} sx={{ padding: 'unset' }}>
                        <SiteEmailsCard />
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
