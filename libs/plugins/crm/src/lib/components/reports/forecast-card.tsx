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
  Box,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { limit, orderBy, query, where } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { collectionCeiling } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { plural } from './report-format'
import {
  type CrmReportScope,
  reportCacheKey,
  scopedCollection,
  visibleToClause,
} from './report-scope'
import { useWindowRead } from './use-aggregate-read'

/**
 * The same window the pipeline card reads, under the SAME cache key and
 * the same dependencies, so the two cards cost one read between them —
 * `useAggregateRead` joins a read already in the air for the key. The
 * numbers must match the pipeline card's query exactly or the key would
 * name two different questions.
 */
const OPEN_DEAL_CEILING = 1000
const PIPELINE_CEILING = 20

type DealRow = Aglyn.CrmDeal & { $id: string }
type PipelineRow = Aglyn.CrmPipeline & { $id: string }

export interface ForecastCardProps {
  report: CrmReportScope
}

/** `Sep 2026` — the month a column is. */
function monthLabel(startMs: number): string {
  return new Date(startMs).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

/**
 * Forecast by close month (AGL-2620): the open pipeline laid out by the
 * month each deal is expected to close, for the next six, per pipeline,
 * at face value and weighted by the stage.
 *
 * Not period-scoped, like the pipeline card and for the same reason: the
 * forecast is what is open NOW, looked at forward. Deals with no expected
 * close are their own row rather than a footnote — that row is the size
 * of the pipeline nobody has scheduled, which is the number the picker
 * of a close date most needs to see — and deals dated before this month
 * (overdue) or past the sixth (later) are rows too, so the column adds up
 * to the pipeline.
 */
export function ForecastCard(props: ForecastCardProps) {
  const { report } = props
  const { scope, tokens, nowMs } = report
  const firestore = useFirestore()

  const dealWindow = useWindowRead<DealRow>(
    () =>
      query(
        scopedCollection(firestore, scope, 'deals'),
        ...visibleToClause(tokens),
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
        query(scopedCollection(firestore, scope, 'pipelines'), ...visibleToClause(tokens)),
        PIPELINE_CEILING,
      ),
    PIPELINE_CEILING,
    [firestore, scope, tokens, nowMs],
    { cacheKey: reportCacheKey(report, 'pipeline:pipelines') },
  )

  const forecast = useMemo(
    () => Aglyn.forecastByCloseMonth(dealWindow.rows, pipelineWindow.rows, nowMs),
    [dealWindow.rows, pipelineWindow.rows, nowMs],
  )
  const currency = useMemo(() => Aglyn.currencyOfDeals(dealWindow.rows), [dealWindow.rows])
  const read = dealWindow.status === 'success' && pipelineWindow.status === 'success'
  const failed = dealWindow.status === 'error' || pipelineWindow.status === 'error'

  // A pipeline with nothing open is still a column; an unknown pipeline id
  // is a column named for what it is.
  const columns = forecast.pipelines
  const manyColumns = columns.length > 1

  const rows: Array<{ key: string; label: string; cellOf: (row: Aglyn.PipelineForecast) => Aglyn.ForecastCell; total: Aglyn.ForecastCell; muted?: boolean }> = [
    {
      key: 'overdue',
      label: 'Before this month',
      cellOf: (row) => row.overdue,
      total: forecast.overdue,
      muted: true,
    },
    ...forecast.buckets.map((bucket, index) => ({
      key: bucket.key,
      label: monthLabel(bucket.start),
      cellOf: (row: Aglyn.PipelineForecast) => row.months[index],
      total: forecast.months[index],
    })),
    {
      key: 'later',
      label: 'Later',
      cellOf: (row) => row.later,
      total: forecast.later,
      muted: true,
    },
    {
      key: 'undated',
      label: 'No expected close',
      cellOf: (row) => row.undated,
      total: forecast.undated,
      muted: true,
    },
  ].filter((row) => row.key !== 'overdue' && row.key !== 'later' ? true : row.total.count > 0)

  const cell = (value: Aglyn.ForecastCell, code: string) =>
    value.count === 0 ? (
      <Typography variant="body2" color="text.disabled">
        {'—'}
      </Typography>
    ) : (
      <Stack sx={{ lineHeight: 1.2 }}>
        <Typography variant="body2">{money(value.amountCents, code)}</Typography>
        <Typography variant="caption" color="text.secondary">
          {`${money(value.weightedCents, code)} weighted · ${plural(value.count, 'deal')}`}
        </Typography>
      </Stack>
    )

  return (
    <CardDisplay
      header={'Forecast by close month'}
      help={Aglyn.pluginDocsHelp('crmReports', {
        anchor: '#forecast-by-close-month',
        excerpt:
          'Every open deal by the month it is expected to close, for the ' +
          'next six months and per pipeline, at face value and weighted by ' +
          'its stage. Deals with no expected close are their own row.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        {failed ? (
          <Typography variant="body2" color="warning.main">
            {'The forecast could not be read.'}
          </Typography>
        ) : !read ? (
          <Typography variant="body2" color="text.secondary">
            {'—'}
          </Typography>
        ) : forecast.total.count === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No open deals yet.'}
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="Forecast by close month">
              <TableHead>
                <TableRow>
                  <TableCell>{'Expected close'}</TableCell>
                  {columns.map((column) => (
                    <TableCell key={column.pipelineId} align="right">
                      {column.name || 'Pipeline not visible'}
                    </TableCell>
                  ))}
                  {manyColumns ? <TableCell align="right">{'All pipelines'}</TableCell> : null}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key} data-forecast-row={row.key}>
                    <TableCell>
                      <Typography variant="body2" color={row.muted ? 'text.secondary' : undefined}>
                        {row.label}
                      </Typography>
                    </TableCell>
                    {columns.map((column) => (
                      <TableCell key={column.pipelineId} align="right">
                        {cell(row.cellOf(column), currency.currency)}
                      </TableCell>
                    ))}
                    {manyColumns ? (
                      <TableCell align="right">{cell(row.total, currency.currency)}</TableCell>
                    ) : null}
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>
                    <Typography variant="subtitle2">{'Open pipeline'}</Typography>
                  </TableCell>
                  {columns.map((column) => (
                    <TableCell key={column.pipelineId} align="right">
                      {cell(column.total, currency.currency)}
                    </TableCell>
                  ))}
                  {manyColumns ? (
                    <TableCell align="right">{cell(forecast.total, currency.currency)}</TableCell>
                  ) : null}
                </TableRow>
              </TableBody>
            </Table>
          </Box>
        )}
        {read && currency.mixed ? (
          <Typography variant="caption" color="text.secondary">
            {`Deals are in more than one currency; the figures add them as numbers and show ${currency.currency.toUpperCase()}, the most common.`}
          </Typography>
        ) : null}
        {read && dealWindow.truncated ? (
          <Typography variant="caption" color="text.secondary">
            {`From the ${OPEN_DEAL_CEILING.toLocaleString()} most recently updated open deals.`}
          </Typography>
        ) : null}
        {read && pipelineWindow.truncated ? (
          <Typography variant="caption" color="text.secondary">
            {`Only the first ${PIPELINE_CEILING} pipelines are named.`}
          </Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
ForecastCard.displayName = 'ForecastCard'

export default ForecastCard
