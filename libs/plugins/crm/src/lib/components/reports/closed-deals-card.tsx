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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  measuredRate,
  percent,
  Section,
} from '@aglyn/shared-ui-jsx/components/measured-figures.component'
import { Alert, Stack, Typography } from '@mui/material'
import {
  count,
  getAggregateFromServer,
  getCountFromServer,
  limit,
  orderBy,
  query,
  sum,
  where,
} from 'firebase/firestore'
import { useMemo } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { ceilingedWindow } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { ReportBarChart } from './report-bar-chart'
import { weekLabel } from './report-format'
import {
  type CrmReportScope,
  scopedCollection,
  visibleToClause,
} from './report-scope'
import { ReportStatTile } from './report-stat-tile'
import { useAggregateRead } from './use-aggregate-read'

/**
 * How many closed deals of each outcome the weekly chart reads.
 *
 * The tiles are server aggregates and never meet this bound; the chart
 * needs each deal's `closedAtMs` to place it in a week, so it reads them,
 * most recent first, and says when the period held more.
 */
const CLOSED_DEAL_CEILING = 500

type DealRow = Aglyn.CrmDeal & { $id: string }

export interface ClosedDealsCardProps {
  report: CrmReportScope
}

/**
 * Deals won and lost in the period, and the win rate over what closed
 * (AGL-2604).
 *
 * Won and lost are TWO queries rather than one over `status in [won,
 * lost]`: each is an equality the `(visibleTo, status, closedAtMs)` index
 * serves directly, and a card that drew one series from a merged read
 * would have to split it again by hand. The range is on `closedAtMs`, the
 * moment the deal was closed — not `updatedAt`, which a note added last
 * week would move.
 */
export function ClosedDealsCard(props: ClosedDealsCardProps) {
  const { report } = props
  const { scope, tokens, range, routes } = report
  const firestore = useFirestore()

  const closedInPeriod = (status: Aglyn.CrmDealStatus) =>
    query(
      scopedCollection(firestore, scope, 'deals'),
      visibleToClause(tokens),
      where('status', '==', status),
      where('closedAtMs', '>=', range.from),
      where('closedAtMs', '<', range.to),
    )

  const closed = useAggregateRead(
    () =>
      Promise.all([
        getAggregateFromServer(closedInPeriod('won'), {
          count: count(),
          amountCents: sum('amountCents'),
        }).then((snapshot) => ({
          count: Number(snapshot.data().count ?? 0),
          amountCents: Number(snapshot.data().amountCents ?? 0),
        })),
        getCountFromServer(closedInPeriod('lost')).then(
          (snapshot) => snapshot.data().count,
        ),
      ]).then(([won, lost]) => ({ won, lost })),
    [firestore, scope, tokens, range],
  )

  const { data: wonDocs, status: wonStatus } = useFirestoreCollection<DealRow>(
    () =>
      query(
        closedInPeriod('won'),
        orderBy('closedAtMs', 'desc'),
        limit(CLOSED_DEAL_CEILING + 1),
      ),
    [firestore, scope, tokens, range],
    { idField: '$id' },
  )
  const { data: lostDocs, status: lostStatus } = useFirestoreCollection<DealRow>(
    () =>
      query(
        closedInPeriod('lost'),
        orderBy('closedAtMs', 'desc'),
        limit(CLOSED_DEAL_CEILING + 1),
      ),
    [firestore, scope, tokens, range],
    { idField: '$id' },
  )
  const wonWindow = useMemo(
    () => ceilingedWindow(wonDocs ?? undefined, CLOSED_DEAL_CEILING),
    [wonDocs],
  )
  const lostWindow = useMemo(
    () => ceilingedWindow(lostDocs ?? undefined, CLOSED_DEAL_CEILING),
    [lostDocs],
  )

  const chart = useMemo(() => {
    const wonWeeks = Aglyn.bucketByWeek(
      wonWindow.rows,
      (deal) => deal.closedAtMs,
      range.from,
      range.to,
    )
    const lostWeeks = Aglyn.bucketByWeek(
      lostWindow.rows,
      (deal) => deal.closedAtMs,
      range.from,
      range.to,
    )
    return {
      labels: wonWeeks.map((week) => weekLabel(week.start)),
      won: wonWeeks.map((week) => week.items.length),
      wonCents: wonWeeks.map((week) =>
        week.items.reduce(
          (total, deal) => total + Math.max(0, Number(deal.amountCents ?? 0)),
          0,
        ),
      ),
      lost: lostWeeks.map((week) => week.items.length),
      currency: Aglyn.currencyOfDeals(wonWindow.rows).currency,
    }
  }, [wonWindow, lostWindow, range])

  const figures = closed.value
  const winRate = figures
    ? measuredRate(figures.won.count, figures.won.count + figures.lost, 'closed')
    : null
  const chartRead = wonStatus === 'success' && lostStatus === 'success'

  return (
    <CardDisplay
      header={'Won and lost'}
      help={Aglyn.pluginDocsHelp('crmReports', {
        anchor: '#won-and-lost',
        excerpt:
          'Deals closed in the period, by outcome and by week, with the ' +
          'value of what was won and the win rate over everything that ' +
          'closed. Placed by the moment each deal was closed.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
          <ReportStatTile
            label={'Won'}
            value={figures ? figures.won.count.toLocaleString() : null}
            note={
              figures
                ? `${money(figures.won.amountCents, chart.currency)} closed won`
                : undefined
            }
            href={routes.section('deals')}
          />
          <ReportStatTile
            label={'Lost'}
            value={figures ? figures.lost.toLocaleString() : null}
            note={'in the period'}
            riseIsGood={false}
            href={routes.section('deals')}
          />
          <ReportStatTile
            label={'Win rate'}
            value={winRate ? percent(winRate.value) : null}
            note={
              winRate
                ? `${winRate.numerator.toLocaleString()} of ${winRate.denominator.toLocaleString()} ${winRate.denominatorLabel}`
                : figures
                  ? 'nothing closed in the period'
                  : undefined
            }
          />
        </Stack>
        {closed.status === 'error' ? (
          <Alert severity="warning">
            {'The closed-deal totals could not be read.'}
          </Alert>
        ) : null}
        <Section title={'Won vs lost per week'}>
          <ReportBarChart
            labels={chart.labels}
            series={[
              { name: 'Won', color: 'success.main', values: chart.won },
              { name: 'Lost', color: 'error.main', values: chart.lost },
            ]}
            format={(value, seriesIndex, barIndex) =>
              seriesIndex === 0
                ? `Won: ${value.toLocaleString()} · ${money(chart.wonCents[barIndex] ?? 0, chart.currency)}`
                : `Lost: ${value.toLocaleString()}`
            }
            emptyText={chartRead ? 'Nothing closed in this period.' : 'Reading…'}
          />
          {wonWindow.truncated || lostWindow.truncated ? (
            <Typography variant="caption" color="text.secondary">
              {`The chart places the ${CLOSED_DEAL_CEILING} most recently closed of each outcome; the tiles are counted on the server.`}
            </Typography>
          ) : null}
        </Section>
      </Stack>
    </CardDisplay>
  )
}
ClosedDealsCard.displayName = 'ClosedDealsCard'

export default ClosedDealsCard
