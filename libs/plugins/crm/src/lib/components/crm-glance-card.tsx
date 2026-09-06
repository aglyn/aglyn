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
import { money } from '@aglyn/shared-ui-email-campaigns/components/report-figures'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Button, Stack, Typography } from '@mui/material'
import {
  collection,
  getAggregateFromServer,
  getCountFromServer,
  query,
  sum,
  Timestamp,
  where,
} from 'firebase/firestore'
import { useMemo } from 'react'
import {
  useConsoleHostRoute,
  useFirestore,
  useOrgDataScope,
  useOrgPlan,
} from '@aglyn/tenant-feature-instance'
import { crmRoutes } from '../model/crm-routes'
import { scopedCollection, visibleToClause } from './reports/report-scope'
import { ReportStatTile } from './reports/report-stat-tile'
import { useAggregateRead } from './reports/use-aggregate-read'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The lead statuses that mean nobody needs to work the lead any more —
 * the operand of the `in` clause the open-lead figure subtracts with.
 */
const CLOSED_LEAD_STATUSES = Aglyn.CRM_LEAD_STATUSES.filter(
  (status) => !Aglyn.CRM_LEAD_OPEN_STATUSES.includes(status),
)

interface GlanceFigures {
  contacts: number
  newThisWeek: number
  pipelineCents: number
  tasksDue: number
  /** Open leads on this site — new or being worked. */
  leadsToWork: number
}

/**
 * CRM at a glance (AGL-2604): a `hostDashboard` widget with five numbers —
 * contacts, new this week, open pipeline value, tasks due today or overdue,
 * and leads still to work (AGL-2624) — each a link into the section that
 * explains it.
 *
 * Server aggregates and nothing else: a dashboard card mounts on every
 * visit to the site's front page, so it is the one surface on which a
 * bounded read of a thousand rows would be a cost paid for nothing. Each
 * number is a count or a sum the server takes over the same `visibleTo`
 * predicate the hub's sections query with, so the card never shows a figure
 * the section behind the link would not.
 *
 * The lead figure is two counts and a subtraction — every lead on the site,
 * less the closed ones — because a lead nobody has touched carries no status
 * field and Firestore cannot select on a field's absence; see
 * `openLeadsFromCounts`. Leads are host-scoped by path rather than by
 * `visibleTo`, so those two counts run on `hosts/{hostId}/leads` under the
 * site's own rules, the way the Leads section reads it.
 *
 * The widget is handed a host doc id and nothing else, so the org — needed
 * for the consent group whose tokens scope the reads — comes from
 * `useOrgPlan`, and the link base from `useConsoleHostRoute`, the way the
 * commerce glance card builds its store link. Nothing is read until the org
 * has settled: a first round of aggregates against the solo group, replaced
 * by a second against the real one, would be two reads for one answer.
 */
export function CrmGlanceCard(props: { hostId: string }) {
  const { hostId } = props
  const consoleRoute = useConsoleHostRoute(hostId)
  const { org, ready: orgReady } = useOrgPlan(hostId)
  const { scope } = useOrgDataScope({ hostId })
  const firestore = useFirestore()
  const tokens = useMemo(() => {
    if (!orgReady) return null
    const group = Aglyn.consentGroupForHost(org ?? null, hostId)
    return [
      Aglyn.ORG_SCOPE_TOKEN,
      ...group.hostIds.map((id) => Aglyn.hostScopeToken(id)),
    ].slice(0, Aglyn.MAX_SCOPE_HOSTS)
  }, [org, orgReady, hostId])
  // Anchored once per mount so the queries are stable across renders.
  const nowMs = useMemo(() => Date.now(), [])

  const figures = useAggregateRead<GlanceFigures>(() => {
    if (!scope || !tokens) return null
    const contacts = scopedCollection(firestore, scope, 'contacts')
    const deals = scopedCollection(firestore, scope, Aglyn.CRM_COLLECTIONS.deals)
    const tasks = scopedCollection(firestore, scope, Aglyn.CRM_COLLECTIONS.tasks)
    const leads = collection(firestore, 'hosts', hostId, 'leads')
    const day = Aglyn.localDayBounds(nowMs)
    const countOf = (target: ReturnType<typeof query>) =>
      getCountFromServer(target).then((snapshot) => snapshot.data().count)
    return Promise.all([
      countOf(query(contacts, visibleToClause(tokens))),
      countOf(
        query(
          contacts,
          visibleToClause(tokens),
          where('createdAt', '>=', Timestamp.fromMillis(nowMs - WEEK_MS)),
        ),
      ),
      getAggregateFromServer(
        query(deals, visibleToClause(tokens), where('status', '==', 'open')),
        { amountCents: sum('amountCents') },
      ).then((snapshot) => Number(snapshot.data().amountCents ?? 0)),
      // Due today OR overdue: everything open that is due before the day ends.
      countOf(
        query(
          tasks,
          visibleToClause(tokens),
          where('status', '==', 'open'),
          where('dueAtMs', '<', day.end),
        ),
      ),
      countOf(query(leads)),
      countOf(query(leads, where('status', 'in', CLOSED_LEAD_STATUSES))),
    ]).then(([contacts, newThisWeek, pipelineCents, tasksDue, leads, closedLeads]) => ({
      contacts,
      newThisWeek,
      pipelineCents,
      tasksDue,
      leadsToWork: Aglyn.openLeadsFromCounts(leads, closedLeads),
    }))
  }, [firestore, scope, tokens, nowMs, hostId])

  const routes = useMemo(
    () => (consoleRoute.base ? crmRoutes(`${consoleRoute.base}/crm`) : null),
    [consoleRoute.base],
  )
  const value = figures.value

  return (
    <CardDisplay
      header={'CRM at a glance'}
      help={Aglyn.pluginDocsHelp('crmReports', {
        anchor: '#crm-at-a-glance',
        excerpt:
          'Contacts, new contacts this week, the value of every open deal, ' +
          'the tasks due today or overdue, and the leads still to work — ' +
          'each counted on the server and each a link into the CRM.',
      })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button
            component={AppLink as any}
            {...({ componentVariant: 'naked', nativeButton: false } as any)}
            href={consoleRoute.base ? `${consoleRoute.base}/crm` : undefined}
            size="small"
            color="primary"
          >
            {'Open CRM'}
          </Button>
        ),
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
          <ReportStatTile
            label={'Contacts'}
            value={value ? value.contacts.toLocaleString() : null}
            href={routes?.section('contacts')}
          />
          <ReportStatTile
            label={'New this week'}
            value={value ? value.newThisWeek.toLocaleString() : null}
            href={routes?.section('contacts')}
          />
          <ReportStatTile
            label={'Open pipeline'}
            value={value ? money(value.pipelineCents, 'usd') : null}
            href={routes?.section('deals')}
          />
          <ReportStatTile
            label={'Tasks due'}
            value={value ? value.tasksDue.toLocaleString() : null}
            note={'today or overdue'}
            color={value?.tasksDue ? 'warning.main' : undefined}
            href={routes?.section('tasks')}
          />
          <ReportStatTile
            label={'Leads to work'}
            value={value ? value.leadsToWork.toLocaleString() : null}
            note={'open on this site'}
            href={routes?.section('leads')}
          />
        </Stack>
        {figures.status === 'error' ? (
          <Typography variant="caption" color="text.secondary">
            {'The CRM figures could not be read. Open the CRM for the full picture.'}
          </Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
CrmGlanceCard.displayName = 'CrmGlanceCard'

export default CrmGlanceCard
