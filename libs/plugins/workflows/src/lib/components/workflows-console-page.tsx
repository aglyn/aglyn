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
import { useMemo, type ReactNode } from 'react'
import HostActionsCard from './host-actions-card.component'
import HostWebhooksCard from './host-webhooks-card.component'
import HostWorkflowsCard from './host-workflows-card.component'
import OrgAutomationsCard from './org-automations-card.component'
import OrgSiteAutomationList from './org-site-automation-list.component'
import RunQuotaLine from './run-quota-line.component'
import SiteOrgAutomationsPanel from './site-org-automations-panel.component'
import type { WorkflowsConsoleSectionId } from './workflows-console-sections'
import {
  workflowsOrgMount,
  type WorkflowsOrgMount,
} from './workflows-org-mount'

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
          {/* What the organization runs on this site beside the site's own
              actions, and the site's pause for each (AGL-3302). */}
          <SiteOrgAutomationsPanel hostId={hostId} />
        </Stack>
      )
    case 'webhooks':
      return <HostWebhooksCard hostId={hostId} org={org} />
    default:
      return null
  }
}

/**
 * The body of one ORGANIZATION-level section (AGL-3302): the org automations,
 * and every site's own workflows, actions and webhooks listed with the site
 * each belongs to.
 *
 * No run allowance line: the allowance is each site's, and an org
 * automation's runs count on the site they run on — each site's own
 * Automation reports its meter.
 */
function orgSectionBody(
  section: WorkflowsConsoleSectionId,
  mount: WorkflowsOrgMount,
  org: Partial<AglynOrgBilling> | undefined,
  canEdit: boolean,
): ReactNode {
  switch (section) {
    case 'automations':
      return <OrgAutomationsCard mount={mount} org={org} canEdit={canEdit} />
    case 'workflows':
    case 'actions':
      return <OrgSiteAutomationList mount={mount} kind={section} canRead />
    case 'webhooks':
      // A webhook holds its site's secret: the rules admit a site's admins
      // and editors, which every org-wide member but a viewer is.
      return (
        <OrgSiteAutomationList mount={mount} kind="webhooks" canRead={canEdit} />
      )
    default:
      return null
  }
}

/**
 * Automation page (AGL-101/148/149 → AGL-395): the automation surface —
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
 *
 * The section ids are unchanged by the Automation rename: they are the
 * addresses people bookmark and the docs link to. A workflow belongs to the
 * site and an ACTION belongs to the site too; an interaction belongs to the
 * document that holds it and is edited on the element, not here.
 */
export function WorkflowsConsolePage(props: ConsolePluginPageProps) {
  const { hostId, orgMount, org, permissions, section, sections, basePath } =
    props
  /*
   * Mounted with no site: the organization's hub (AGL-3302). Memoised so the
   * cards below, which key their listeners on the mount's org, see one object.
   */
  const mount = useMemo(
    () => (hostId == null ? workflowsOrgMount(orgMount, basePath) : null),
    [hostId, orgMount, basePath],
  )

  /*
   * Nothing until the URL names a section. The shell redirects a bare hub URL
   * to the landing section and holds a spinner while it does, so this state is
   * transient — and rendering a default section here instead would pay for its
   * listens on a URL that is already being replaced.
   */
  if (!section || !sections?.length || !basePath) return null

  if (hostId == null) {
    // No site and no org to stand in for it: nothing this page can scope.
    if (!mount) return null
    return (
      <HubSections sections={sections}>
        {orgSectionBody(
          section as WorkflowsConsoleSectionId,
          mount,
          org,
          // An org viewer's `editHosts` is false; every other org role's is
          // true. The server routes decide — this keeps a viewer from being
          // offered controls that are about to refuse them.
          permissions?.editHosts !== false,
        )}
      </HubSections>
    )
  }

  return (
    <HubSections sections={sections}>
      {sectionBody(section as WorkflowsConsoleSectionId, hostId, org)}
    </HubSections>
  )
}
WorkflowsConsolePage.displayName = 'WorkflowsConsolePage'

export default WorkflowsConsolePage
