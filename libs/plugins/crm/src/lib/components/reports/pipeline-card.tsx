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
import { Section } from '@aglyn/shared-ui-jsx/components/measured-figures.component'
import {
  Alert,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  count,
  getAggregateFromServer,
  limit,
  orderBy,
  query,
  sum,
  where,
} from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { collectionCeiling } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { ReportBreakdown } from './report-breakdown'
import { plural, shortDate } from './report-format'
import {
  type CrmReportScope,
  reportCacheKey,
  scopedCollection,
  visibleToClause,
} from './report-scope'
import { ReportStatTile } from './report-stat-tile'
import { useAggregateRead, useWindowRead } from './use-aggregate-read'

/**
 * How many open deals the by-stage chart, the forecast and the top-deals
 * table are read from.
 *
 * The count and the face value of the pipeline are server aggregates and
 * never meet this bound. The forecast cannot be: it weights each deal by
 * ITS stage's odds, which is a join the server will not do, so it reads the
 * deals and says so when there were more than this.
 */
const OPEN_DEAL_CEILING = 1000
/** More pipelines than this is a shape nobody has asked for; the probe says if it happens. */
const PIPELINE_CEILING = 20
const TOP_DEALS = 10

type DealRow = Aglyn.CrmDeal & { $id: string }
type PipelineRow = Aglyn.CrmPipeline & { $id: string }

export interface PipelineCardProps {
  report: CrmReportScope
}

/**
 * The open pipeline: how many deals, what they add up to, what they are
 * worth at their stage odds, where they sit, and the largest of them
 * (AGL-2604).
 *
 * Not period-scoped, deliberately. A pipeline is a stock, not a flow — what
 * is open NOW — and a "pipeline over the last 30 days" would be a report on
 * deals created in a window, which is a different question with a different
 * answer. The period picker governs the cards that measure flows.
 */
export function PipelineCard(props: PipelineCardProps) {
  const { report } = props
  const { scope, tokens, routes, nowMs } = report
  const firestore = useFirestore()

  const open = useAggregateRead(
    () =>
      getAggregateFromServer(
        query(
          scopedCollection(firestore, scope, 'deals'),
          visibleToClause(tokens),
          where('status', '==', 'open'),
        ),
        { count: count(), amountCents: sum('amountCents') },
      ).then((snapshot) => ({
        count: Number(snapshot.data().count ?? 0),
        amountCents: Number(snapshot.data().amountCents ?? 0),
      })),
    [firestore, scope, tokens, nowMs],
    { cacheKey: reportCacheKey(report, 'pipeline:open') },
  )

  /**
   * The open deals, most recently updated first — the order the
   * `(visibleTo, status, updatedAt)` index the deals list already uses can
   * serve, so the report adds no index for this read.
   */
  const dealWindow = useWindowRead<DealRow>(
    () =>
      query(
        scopedCollection(firestore, scope, 'deals'),
        visibleToClause(tokens),
        where('status', '==', 'open'),
        orderBy('updatedAt', 'desc'),
        limit(OPEN_DEAL_CEILING + 1),
      ),
    OPEN_DEAL_CEILING,
    [firestore, scope, tokens, nowMs],
    { cacheKey: reportCacheKey(report, 'pipeline:deals') },
  )
  const pipelineWindow = useWindowRead<PipelineRow>(
    () =>
      collectionCeiling(
        query(
          scopedCollection(firestore, scope, 'pipelines'),
          visibleToClause(tokens),
        ),
        PIPELINE_CEILING,
      ),
    PIPELINE_CEILING,
    [firestore, scope, tokens, nowMs],
    { cacheKey: reportCacheKey(report, 'pipeline:pipelines') },
  )
  const dealsStatus = dealWindow.status

  const summary = useMemo(() => {
    const byPipeline = new Map<string, DealRow[]>()
    for (const deal of dealWindow.rows) {
      const key = deal.pipelineId ?? ''
      const list = byPipeline.get(key) ?? []
      list.push(deal)
      byPipeline.set(key, list)
    }
    const pipelines = pipelineWindow.rows.map((pipeline) => ({
      pipeline,
      totals: Aglyn.pipelineTotals(byPipeline.get(pipeline.$id) ?? [], pipeline),
    }))
    const known = new Set(pipelineWindow.rows.map((pipeline) => pipeline.$id))
    const orphans = dealWindow.rows.filter(
      (deal) => !known.has(deal.pipelineId ?? ''),
    )
    const stageName = (deal: DealRow): string =>
      Aglyn.dealStageById(
        pipelineWindow.rows.find((pipeline) => pipeline.$id === deal.pipelineId),
        deal.stageId,
      )?.name ?? deal.stageId
    const top = [...dealWindow.rows]
      .sort(
        (a, b) => Number(b.amountCents ?? 0) - Number(a.amountCents ?? 0),
      )
      .slice(0, TOP_DEALS)
    return {
      pipelines,
      orphanTotals: Aglyn.pipelineTotals(orphans, null),
      weightedCents: pipelines.reduce(
        (total, entry) => total + entry.totals.weightedCents,
        0,
      ),
      top,
      stageName,
      currency: Aglyn.currencyOfDeals(dealWindow.rows),
    }
  }, [dealWindow, pipelineWindow])

  const currency = summary.currency.currency
  const dealsRead = dealsStatus === 'success'

  return (
    <CardDisplay
      header={'Pipeline'}
      help={Aglyn.pluginDocsHelp('crmReports', {
        anchor: '#pipeline',
        excerpt:
          'Every open deal: how many, what they add up to, and what they ' +
          'are worth once each is weighted by the odds of its stage. Not ' +
          'tied to the period — a pipeline is what is open now.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
          <ReportStatTile
            label={'Open deals'}
            value={open.value ? open.value.count.toLocaleString() : null}
            note={'counted on the server'}
            href={routes.section('deals')}
          />
          <ReportStatTile
            label={'Pipeline value'}
            value={open.value ? money(open.value.amountCents, currency) : null}
            note={'face value of every open deal'}
            href={routes.section('deals')}
          />
          <ReportStatTile
            label={'Weighted forecast'}
            value={dealsRead ? money(summary.weightedCents, currency) : null}
            note={
              dealWindow.truncated
                ? `from the ${OPEN_DEAL_CEILING.toLocaleString()} most recently updated`
                : 'each deal at its stage odds'
            }
          />
        </Stack>
        {open.status === 'error' ? (
          <Alert severity="warning">
            {'The deal totals could not be read.'}
          </Alert>
        ) : null}
        {summary.currency.mixed ? (
          <Typography variant="caption" color="text.secondary">
            {`Deals are in more than one currency; the totals add them as numbers and show ${currency.toUpperCase()}, the most common.`}
          </Typography>
        ) : null}
        {dealsRead && !summary.pipelines.length && !dealWindow.rows.length ? (
          <Typography variant="body2" color="text.secondary">
            {'No open deals yet.'}
          </Typography>
        ) : null}
        {summary.pipelines.map(({ pipeline, totals }) => (
          <Section key={pipeline.$id} title={pipeline.name || 'Pipeline'}>
            <ReportBreakdown
              rows={[
                ...totals.stages.map((row) => ({
                  key: row.stage.id,
                  label: row.stage.name,
                  value: row.amountCents,
                  display: money(row.amountCents, currency),
                  note: `${plural(row.count, 'deal')} · ${money(row.weightedCents, currency)} weighted`,
                })),
                ...(totals.unplaced.count
                  ? [
                      {
                        key: '$unplaced',
                        label: 'Stage no longer in this pipeline',
                        value: totals.unplaced.amountCents,
                        display: money(totals.unplaced.amountCents, currency),
                        note: `${plural(totals.unplaced.count, 'deal')} · not forecast`,
                        color: 'warning.main',
                      },
                    ]
                  : []),
              ]}
              emptyText={'This pipeline has no open stages.'}
            />
          </Section>
        ))}
        {summary.orphanTotals.count ? (
          <Section title={'Deals in no pipeline'}>
            <ReportBreakdown
              rows={[
                {
                  key: '$orphans',
                  label: 'No pipeline',
                  value: summary.orphanTotals.amountCents,
                  display: money(summary.orphanTotals.amountCents, currency),
                  note: `${plural(summary.orphanTotals.count, 'deal')} · not forecast`,
                  color: 'warning.main',
                },
              ]}
              emptyText={''}
            />
          </Section>
        ) : null}
        {pipelineWindow.truncated ? (
          <Typography variant="caption" color="text.secondary">
            {`Only the first ${PIPELINE_CEILING} pipelines are charted.`}
          </Typography>
        ) : null}
        {summary.top.length ? (
          <Section title={'Top open deals'}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Deal'}</TableCell>
                  <TableCell>{'Stage'}</TableCell>
                  <TableCell>{'Expected close'}</TableCell>
                  <TableCell align="right">{'Amount'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {summary.top.map((deal) => (
                  <TableRow key={deal.$id}>
                    <TableCell>
                      <AppLink href={routes.deal(deal.$id)}>
                        {deal.title || deal.$id}
                      </AppLink>
                    </TableCell>
                    <TableCell>{summary.stageName(deal)}</TableCell>
                    <TableCell>{shortDate(deal.expectedCloseAtMs)}</TableCell>
                    <TableCell align="right">
                      {money(
                        Number(deal.amountCents ?? 0),
                        String(deal.currency || currency),
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {dealWindow.truncated ? (
              <Typography variant="caption" color="text.secondary">
                {`Ranked within the ${OPEN_DEAL_CEILING.toLocaleString()} most recently updated open deals.`}
              </Typography>
            ) : null}
          </Section>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
PipelineCard.displayName = 'PipelineCard'

export default PipelineCard
