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

import { CONSOLE_WIDGET_SLOTS, type ConsolePluginOrgMount } from '@aglyn/aglyn'
import { Box } from '@mui/material'
import useOrgPermissions from '../hooks/use-org-permissions'
import { useOrgReach } from '../hooks/use-org-reach'
import { resolveOrgCrmAccess } from '../utils/org-crm-access'
import PluginWidgetSlot, { useSlotWidgets } from './plugin-widget-slot.component'

export interface OrgDashboardWidgetsProps {
  /**
   * The org and its sites, as `resolveOrgMount` builds it from the list the
   * page already reads — or `undefined` until the workspace has resolved,
   * which holds the row.
   */
  orgMount: ConsolePluginOrgMount | undefined
  /** The org-level hub's own path, where a widget's links go. */
  basePath: string
}

/**
 * The organization's dashboard row (AGL-2636): every widget registered for
 * `orgDashboard`, on the org's sites page above the site grid, for an
 * org-wide member who may open the org-level CRM — and nothing at all for
 * anyone else, or when no widget survives the gates.
 *
 * ## The gate in front of the row, and why it is the org hub's
 *
 * `PluginWidgetSlot` composes enablement, entitlement and each widget's
 * permission, as it does for every slot. This adds the one question those
 * gates cannot answer: REACH. A widget here totals the organization, so its
 * reads carry no scope clause, and that is the one read a site collaborator
 * may never make — they are a real org member holding a real permission,
 * and a slot gated on permission alone would mount a card that opens
 * listeners the rules then refuse. `resolveOrgCrmAccess` is the verdict the
 * org CRM hub renders behind (reach first, then `data.manage`, both settled
 * before either is believed), and the CRM is what registers on this slot
 * today; a second plugin's org widget would relax this to reach alone and
 * leave its permission to the slot's own gate.
 *
 * ## Not arrangeable, on purpose
 *
 * No `DashboardWidgetPrefsProvider` is mounted here, so the slot reads the
 * inert arrangement — `customizable: false`, ready at once — and renders
 * the moment its widgets resolve; it never waits for a preference that is
 * not coming. The stored arrangement is keyed PER ORG by widget id, and
 * these cards carry the ids their site twins carry, so a provider here would
 * either share one arrangement with every site dashboard in the organization
 * — a card hidden on one site vanishing from the org row — or need a second
 * keyspace and a second customize dialog for a row of two cards on a list
 * page. Neither is worth having while the row is two cards.
 *
 * `useSlotWidgets` is consulted here as well as inside the slot so that a
 * row with nothing to draw is no row: no grid, no gap above the sites.
 */
export function OrgDashboardWidgets(props: OrgDashboardWidgetsProps) {
  const { orgMount, basePath } = props
  const { orgWide, ready: reachReady } = useOrgReach()
  const {
    can,
    loaded: permissionsLoaded,
    errored: permissionsErrored,
  } = useOrgPermissions()
  const access = resolveOrgCrmAccess({
    orgWide,
    reachReady,
    can,
    permissionsLoaded,
    permissionsErrored,
  })
  const { widgets } = useSlotWidgets([CONSOLE_WIDGET_SLOTS.orgDashboard])
  if (access !== 'granted' || !orgMount || widgets.length === 0) return null
  return (
    // The host dashboard's capability grid, for the same reason it is a
    // grid there: the shell does not know how many cards a slot holds, and a
    // widget that renders null occupies no track.
    <Box
      sx={{
        display: 'grid',
        gap: 3,
        alignItems: 'start',
        mb: 3,
        gridTemplateColumns: {
          xs: '1fr',
          md: 'repeat(2, minmax(0, 1fr))',
        },
      }}
    >
      <PluginWidgetSlot
        slot={CONSOLE_WIDGET_SLOTS.orgDashboard}
        hostId={null}
        orgMount={orgMount}
        basePath={basePath}
      />
    </Box>
  )
}
OrgDashboardWidgets.displayName = 'OrgDashboardWidgets'

export default OrgDashboardWidgets
