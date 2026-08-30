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
import { Container } from '@aglyn/shared-ui-jsx'
import { HubSections, useActiveSection } from '@aglyn/shared-ui-next'
import { useAnalytics } from '@aglyn/tenant-feature-instance'
import { logEvent } from 'firebase/analytics'
import { useEffect, useMemo, type ReactNode } from 'react'
import {
  useHostId,
  useHostSubdomain,
} from '../../../../../../../components/host-id-provider'
import DashboardLayout from '../../../../../../../components/layouts/dashboard.layout'
import PluginWidgetSlot from '../../../../../../../components/plugin-widget-slot.component'
import HostDisplayNameComponent from '../../../../../../../components/host-display-name.component'
import { buildRoute, Route } from '../../../../../../../constants/route-links'
import { useOrgSlug } from '../../../../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../../../../constants/shared'
import { HostSettingsScopeProvider } from '../../host-settings-scope'
import { setupSections } from '../setup-sections'

const HostSetupSectionsLayout = ({ children }: { children: ReactNode }) => {
  const analytics = useAnalytics()
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()

  const sections = useMemo(
    () => setupSections(orgSlug, host),
    [orgSlug, host],
  )
  /*
   * Resolved against the same list the rail draws, so the trail names the
   * section the reader is on instead of ending at "Setup". One resolver, so a
   * section added to the list is in the breadcrumb by construction.
   */
  const active = useActiveSection(sections)

  /*
   * A pageview per SECTION, which the tab strip used to emit from its change
   * handler. Sections are routes now, so it is keyed on the section the URL
   * names — which also means arriving by link or by back button is counted,
   * where the handler only ever saw a click.
   *
   * `analytics` is undefined whenever Firebase Analytics failed to initialise
   * (ad blocker, blocked storage, missing measurement id); `useAnalytics()` is
   * typed as if it never is, and strictNullChecks is off, so the guard is what
   * stops a pageview throwing out of an effect.
   */
  useEffect(() => {
    if (!analytics || !active) return
    logEvent(analytics, 'screen_view', {
      firebase_screen: active.label,
      firebase_screen_class: 'HostSetupSections',
    })
  }, [analytics, active])

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: <HostDisplayNameComponent hostId={hostId} />,
          href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
        },
        {
          children: 'Setup',
          href: buildRoute(Route.HOST_SETUP, { orgSlug, host }),
        },
        // The section the reader is actually on. Without it the trail names
        // every level except theirs — the one that says where they are.
        ...(active ? [{ children: active.label }] : []),
      ]}
      help="gettingStarted"
      header={{
        children: 'Host Setup',
        icon: { path: ICON_VARIANT_APP_SETTINGS.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <HostSettingsScopeProvider>
          <HubSections sections={sections}>{children}</HubSections>
        </HostSettingsScopeProvider>
        {/* Plugin zone (AGL-433): hostSettings widgets. */}
        <PluginWidgetSlot slot="hostSettings" hostId={hostId} />
      </Container>
    </DashboardLayout>
  )
}

HostSetupSectionsLayout.displayName = 'Layout:HostSetupSections'

export default HostSetupSectionsLayout
