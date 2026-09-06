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
import { mdiRefresh } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Box,
  Button,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { getCountFromServer, query } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useCrmScope } from '../hooks/use-crm-scope'
import { crmRoutes } from '../model/crm-routes'
import { ActivityCard } from './reports/activity-card'
import { ClosedDealsCard } from './reports/closed-deals-card'
import { ContactsMixCard } from './reports/contacts-mix-card'
import { ContactsTrendCard } from './reports/contacts-trend-card'
import { ForecastCard } from './reports/forecast-card'
import { LeadFunnelCard } from './reports/lead-funnel-card'
import { PipelineCard } from './reports/pipeline-card'
import { SourceConversionCard } from './reports/source-conversion-card'
import {
  type CrmReportScope,
  reportCacheKey,
  reportCachePrefix,
  scopedCollection,
  visibleToClause,
} from './reports/report-scope'
import { TasksCard } from './reports/tasks-card'
import { invalidateAggregateReads, useAggregateRead } from './reports/use-aggregate-read'

/**
 * `/crm/reports` — the CRM in aggregate (AGL-2604, AGL-2624).
 *
 * Nine cards, each reading its own collection: contacts over time, contacts
 * by source and stage, which sources convert, this site's lead funnel, the
 * open pipeline, what closed, who logged what, the forecast by close month
 * (AGL-2620, over the pipeline card's own window), and the task load. This
 * section resolves what they share and hands it down — see `CrmReportScope`
 * — so that every card counts the same reader's records over the same
 * clock. The lead funnel is the one card handed the site as well: leads live
 * under the host, not the org.
 *
 * ## The period is a control, and the reads follow it
 *
 * Nothing on this page reads a year on mount. The picker names the period,
 * the period sizes every read (one count per week of it, the deals closed
 * within it), and the default is thirty days. The three cards that are
 * stocks rather than flows — the open pipeline, its forecast, the open
 * tasks — ignore the period because "what is open" has no period.
 *
 * ## Scoped like the list
 *
 * Every query carries `visibleTo array-contains-any` over the group's
 * tokens, the predicate the rules evaluate, so a report can never count a
 * record its reader could not open — and the total here is the reader's
 * total, not the org's billable audience, which is the head-count the
 * contacts list keeps for the quota.
 *
 * ## Read once a minute, not once an arrival
 *
 * Every read on this page is keyed by the scope and the period and kept
 * for `AGGREGATE_READ_TTL_MS` — see `useAggregateRead` — so leaving to open
 * a deal the report named and coming straight back costs nothing. Refresh
 * forgets this reader's answers for this org and anchors the period again,
 * which is what makes every card ask afresh.
 */
export function ContactsReportsSection(props: ConsolePluginPageProps) {
  const { hostId, org, basePath } = props
  const firestore = useFirestore()
  // The org data root — null until the org lookup settles, and the page
  // reads nothing until it does — and the controller this page is viewed
  // as, resolved the way every CRM surface resolves them so the facet a
  // stage is read from here is the facet the contacts list edits it in.
  const { scope: dataScope, consentGroup, visibleTo } = useCrmScope({ hostId, org })
  const tokens = useMemo(() => [...visibleTo], [visibleTo])
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
  const refresh = useCallback(() => {
    if (dataScope) {
      invalidateAggregateReads(
        reportCachePrefix({ scope: dataScope, tokens, groupId: consentGroup.groupId }),
      )
    }
    // A new anchor is what changes every card's dependencies, so each read
    // runs again and — its key forgotten — reaches the server.
    setView((current) => ({ period: current.period, nowMs: Date.now() }))
  }, [dataScope, tokens, consentGroup.groupId])

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
    // The anchor is a dependency so Refresh re-asks; the key, which omits
    // it, is what answers a reopened section from memory.
    [firestore, dataScope, tokens, view.nowMs],
    report ? { cacheKey: reportCacheKey(report, 'contacts:total') } : {},
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
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
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
          <Button
            size="small"
            startIcon={<MdiIcon path={mdiRefresh.path} size={0.8} />}
            disabled={!report}
            onClick={refresh}
          >
            {'Refresh'}
          </Button>
        </Stack>
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
          <SourceConversionCard report={report} />
          <LeadFunnelCard report={report} hostId={hostId} />
          <PipelineCard report={report} />
          <ClosedDealsCard report={report} />
          <ActivityCard report={report} />
          <Box sx={{ gridColumn: { lg: '1 / -1' } }}>
            <ForecastCard report={report} />
          </Box>
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
