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

import * as Aglyn from '@aglyn/aglyn'
import type { ConsolePluginPageProps } from '@aglyn/aglyn'
import {
  Box,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { getCountFromServer, query } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { useFirestore, useOrgDataScope } from '@aglyn/tenant-feature-instance'
import { crmRoutes } from '../model/crm-routes'
import { ClosedDealsCard } from './reports/closed-deals-card'
import { ContactsMixCard } from './reports/contacts-mix-card'
import { ContactsTrendCard } from './reports/contacts-trend-card'
import { PipelineCard } from './reports/pipeline-card'
import {
  type CrmReportScope,
  scopedCollection,
  visibleToClause,
} from './reports/report-scope'
import { TasksCard } from './reports/tasks-card'
import { useAggregateRead } from './reports/use-aggregate-read'

/**
 * `/crm/reports` — the CRM in aggregate (AGL-2604).
 *
 * Five cards, each reading its own collection: contacts over time, contacts
 * by source and stage, the open pipeline, what closed, and the task load.
 * This section resolves what they share and hands it down — see
 * `CrmReportScope` — so that every card counts the same reader's records
 * over the same clock.
 *
 * ## The period is a control, and the reads follow it
 *
 * Nothing on this page reads a year on mount. The picker names the period,
 * the period sizes every read (one count per week of it, the deals closed
 * within it), and the default is thirty days. The two cards that are stocks
 * rather than flows — the open pipeline, the open tasks — ignore the period
 * because "what is open" has no period.
 *
 * ## Scoped like the list
 *
 * Every query carries `visibleTo array-contains-any` over the group's
 * tokens, the predicate the rules evaluate, so a report can never count a
 * record its reader could not open — and the total here is the reader's
 * total, not the org's billable audience, which is the head-count the
 * contacts list keeps for the quota.
 */
export function ContactsReportsSection(props: ConsolePluginPageProps) {
  const { hostId, org, basePath } = props
  const firestore = useFirestore()
  // Org-shared data root (AGL-237): null until the org lookup settles, and
  // the page reads nothing until it does.
  const { scope: dataScope } = useOrgDataScope({ hostId })
  // The controller this page is viewed as — the same resolution the contacts
  // list makes, so the facet a stage is read from here is the facet the list
  // edits it in.
  const consentGroup = useMemo(
    () => Aglyn.consentGroupForHost(org as Record<string, unknown>, hostId),
    [org, hostId],
  )
  const tokens = useMemo(
    () =>
      [
        Aglyn.ORG_SCOPE_TOKEN,
        ...consentGroup.hostIds.map((id) => Aglyn.hostScopeToken(id)),
      ].slice(0, Aglyn.MAX_SCOPE_HOSTS),
    [consentGroup],
  )
  /*
   * The period AND the moment it was chosen, as one value: the range is
   * anchored when the reader picks, not re-derived from a moving `Date.now()`
   * per render, which would rebuild every query on every pass.
   */
  const [view, setView] = useState<{
    period: Aglyn.CrmReportPeriod
    nowMs: number
  }>(() => ({ period: '30d', nowMs: Date.now() }))
  const range = useMemo(
    () => Aglyn.crmReportRange(view.period, view.nowMs),
    [view],
  )
  const routes = useMemo(() => crmRoutes(basePath ?? ''), [basePath])

  const report = useMemo<CrmReportScope | null>(
    () =>
      dataScope
        ? {
            scope: dataScope,
            tokens,
            groupId: consentGroup.groupId,
            period: view.period,
            range,
            nowMs: view.nowMs,
            routes,
          }
        : null,
    [dataScope, tokens, consentGroup.groupId, view, range, routes],
  )

  /**
   * Every contact this reader may see, counted once for the two cards that
   * quote it — the tile, and the sample notice that compares the read to it.
   */
  const totalContacts = useAggregateRead<number>(
    () =>
      dataScope
        ? getCountFromServer(
            query(
              scopedCollection(firestore, dataScope, 'contacts'),
              visibleToClause(tokens),
            ),
          ).then((snapshot) => snapshot.data().count)
        : null,
    [firestore, dataScope, tokens],
  )

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={2}
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="h6" component="h2">
          {'Reports'}
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          color="primary"
          value={view.period}
          onChange={(_event, next) => {
            if (next) {
              setView({ period: next as Aglyn.CrmReportPeriod, nowMs: Date.now() })
            }
          }}
          aria-label="Report period"
        >
          {Aglyn.CRM_REPORT_PERIODS.map((period) => (
            <ToggleButton key={period} value={period}>
              {Aglyn.CRM_REPORT_PERIOD_LABELS[period]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>
      {report ? (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
            alignItems: 'start',
          }}
        >
          <ContactsTrendCard report={report} totalContacts={totalContacts} />
          <ContactsMixCard report={report} totalContacts={totalContacts} />
          <PipelineCard report={report} />
          <ClosedDealsCard report={report} />
          <Box sx={{ gridColumn: { lg: '1 / -1' } }}>
            <TasksCard report={report} />
          </Box>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {'Loading…'}
        </Typography>
      )}
    </Stack>
  )
}
ContactsReportsSection.displayName = 'ContactsReportsSection'

export default ContactsReportsSection
