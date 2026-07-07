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

import type * as Aglyn from '@aglyn/aglyn'
import { ICON_VARIANT_THEME_SYSTEM } from '@aglyn/shared-data-enums'
import { Container, useLoading } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useHost } from '@aglyn/tenant-feature-instance'
import { useCallback, useState } from 'react'
import { useHostId } from '../../../components/host-id-provider'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import ThemeEditor from '../../../components/theme-editor/theme-editor.component'
import HostDisplayNameComponent from '../../../components/host-display-name.component'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

const HostTheme: NextPageWithLayout = () => {
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const hostId = useHostId()
  const {
    doc: { data, status },
    setDoc,
  } = useHost({ hostId })
  const [saving, setSaving] = useState(false)

  const handleSave = useCallback(
    async (theme: Aglyn.AglynHostTheme) => {
      setSaving(true)
      const dequeueLoading = queueLoading()
      // mergeFields replaces the theme atomically, so cleared colors do not
      // linger from a deep merge with the previous document.
      await setDoc({ theme }, { mergeFields: ['theme'] })
        .then(() => {
          enqueueSnackbar('Theme saved!', { variant: 'success' })
        })
        .catch((e) => {
          enqueueSnackbar(`Error: ${JSON.stringify(e)}`, { variant: 'error' })
        })
        .finally(() => {
          dequeueLoading()
          setSaving(false)
        })
    },
    [enqueueSnackbar, queueLoading, setDoc],
  )

  return (
    <>
      <NextPageTitle screen={'Host Theme'} />
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
            children: 'Theme',
            href: buildRoute(Route.HOST_THEME, { hostId }),
          },
        ]}
        header={{
          children: 'Host Theme',
          icon: { path: ICON_VARIANT_THEME_SYSTEM.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {status === 'success' ? (
            <ThemeEditor
              theme={data?.theme}
              saving={saving}
              onSave={handleSave}
            />
          ) : null}
        </Container>
      </DashboardLayout>
    </>
  )
}
HostTheme.displayName = 'Page:HostTheme'
HostTheme.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Host Theme',
    },
  },
]

export default HostTheme
