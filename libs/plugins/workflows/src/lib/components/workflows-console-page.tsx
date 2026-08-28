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

import type { AglynOrgBilling, ConsolePluginPageProps } from '@aglyn/aglyn'
import { HubSections } from '@aglyn/shared-ui-next'
import { Stack } from '@mui/material'
import type { ReactNode } from 'react'
import HostActionsCard from './host-actions-card.component'
import HostWebhooksCard from './host-webhooks-card.component'
import HostWorkflowsCard from './host-workflows-card.component'
import RunQuotaLine from './run-quota-line.component'
import type { WorkflowsConsoleSectionId } from './workflows-console-sections'

/**
 * The body of one workflows section, built only when that section is the one
 * being read (AGL-2501).
 *
 * A function rather than a map of nodes on purpose: a `Record<id, ReactNode>`
 * would CONSTRUCT all three every render, and each card opens its Firestore
 * listens on mount — which is the entire cost this page exists to stop paying.
 * Only the returned branch is ever built.
 */
function sectionBody(
  section: WorkflowsConsoleSectionId,
  hostId: string,
  org: Partial<AglynOrgBilling> | undefined,
): ReactNode {
  switch (section) {
    case 'workflows':
      return (
        /*
         * `N runs this month · M included` (AGL-2171), which the run-history
         * mockup puts opposite the heading. The quota silently stops
         * automations running once it is reached, and the only place it was
         * reported was the Billing page.
         */
        <Stack spacing={1}>
          <RunQuotaLine hostId={hostId} org={org} counter="workflowRuns" />
          <HostWorkflowsCard hostId={hostId} org={org} />
        </Stack>
      )
    case 'actions':
      return (
        <Stack spacing={1}>
          {/* `actionRunsPerMonth` had NO customer-facing surface at all
              before this — staff panel and usage-alerts only. */}
          <RunQuotaLine hostId={hostId} org={org} counter="actionRuns" />
          <HostActionsCard hostId={hostId} org={org} />
        </Stack>
      )
    case 'webhooks':
      return <HostWebhooksCard hostId={hostId} org={org} />
    default:
      return null
  }
}

/**
 * Workflows page (AGL-101/148/149 → AGL-395): the automation surface —
 * workflow builder, event-triggered actions, and webhooks — owned by the
 * workflows plugin and rendered by the shell's generic plugin route. Each card
 * runs its own entitlement check (workflows / actions / webhooks are distinct
 * plan flags), so the shell's resolved `org` doc flows into all three.
 *
 * Sections are ROUTES (AGL-2501). `HubTabs lazy` already mounted one panel, so
 * this is not a read saving — `workflows-console-read-cost.spec.tsx` was
 * written BEFORE the conversion precisely to hold that line, and reports the
 * same counts after. What routing adds is that the URL names the section: it is
 * linkable, the back button walks sections, the breadcrumb says where you are,
 * and "mount only what is open" is structural rather than a `lazy` flag.
 */
export function WorkflowsConsolePage(props: ConsolePluginPageProps) {
  const { hostId, org, section, sections, basePath } = props

  /*
   * Nothing until the URL names a section. The shell redirects a bare hub URL
   * to the landing section and holds a spinner while it does, so this state is
   * transient — and rendering a default section here instead would pay for its
   * listens on a URL that is already being replaced.
   */
  if (!section || !sections?.length || !basePath) return null

  return (
    <HubSections sections={sections}>
      {sectionBody(section as WorkflowsConsoleSectionId, hostId, org)}
    </HubSections>
  )
}
WorkflowsConsolePage.displayName = 'WorkflowsConsolePage'

export default WorkflowsConsolePage
