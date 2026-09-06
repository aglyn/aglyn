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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  measuredRate,
  percent,
  Section,
} from '@aglyn/shared-ui-jsx/components/measured-figures.component'
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
  getCountFromServer,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { ReportExport } from './report-export'
import { reportFilename } from './report-format'
import {
  type CrmReportScope,
  reportCacheKey,
  scopedCollection,
  visibleToClause,
} from './report-scope'
import { ReportStatTile } from './report-stat-tile'
import { useAggregateRead, useWindowRead } from './use-aggregate-read'

/**
 * How many of the period's contacts the by-source table is read from.
 *
 * The captured count is a server aggregate and never meets this bound;
 * the table needs each contact's sources and stage off this holder's
 * facet, which no aggregate can read, so it reads the period's newest
 * thousand and says when there were more — the same bound the sources
 * mix keeps, over the period rather than all time.
 */
const CONTACT_CEILING = 1000

/** The table's columns, which are also the CSV's. */
const COLUMNS = ['Source', 'Captured', 'Customers', 'Conversion'] as const

export interface SourceConversionCardProps {
  report: CrmReportScope
}

/**
 * Conversion by source (AGL-2624): of the people captured through each
 * door in the period, how many are customers now.
 *
 * A COHORT by capture date, not a count of purchases in the period: the
 * question is "how well does each source convert", and the honest
 * population for it is the people that source brought in, followed to
 * where they stand today. A form lead captured on day one and buying on
 * day twenty is a conversion the form earned; a customer captured last
 * year who bought again this month is not evidence about this period's
 * doors. So the window is the period's contacts by `createdAt` — the
 * `(visibleTo, createdAt)` index the trend card counts through — and
 * "customer" is read off the facet: the stage at `customer` or past it,
 * or an order on the books whatever the stage says.
 *
 * Through THIS group's facet, like every by-source figure: a source is
 * which of this business's doors the person came through, and a stage is
 * where this business's team put them.
 */
export function SourceConversionCard(props: SourceConversionCardProps) {
  const { report } = props
  const { scope, tokens, groupId, range, period, routes } = report
  const firestore = useFirestore()

  const capturedInPeriod = () =>
    query(
      scopedCollection(firestore, scope, 'contacts'),
      ...visibleToClause(tokens),
      where('createdAt', '>=', Timestamp.fromMillis(range.from)),
      where('createdAt', '<', Timestamp.fromMillis(range.to)),
    )

  const captured = useAggregateRead<number>(
    () => getCountFromServer(capturedInPeriod()).then((snapshot) => snapshot.data().count),
    [firestore, scope, tokens, range],
    { cacheKey: reportCacheKey(report, 'sources:captured') },
  )
  const window = useWindowRead<Record<string, unknown>>(
    () =>
      query(
        capturedInPeriod(),
        orderBy('createdAt', 'desc'),
        limit(CONTACT_CEILING + 1),
      ),
    CONTACT_CEILING,
    [firestore, scope, tokens, range],
    { cacheKey: reportCacheKey(report, 'sources:window') },
  )
  const status = window.status

  const conversion = useMemo(
    () =>
      Aglyn.conversionBySource(
        window.rows.map((row) => Aglyn.readContactFacet(row, groupId)),
      ),
    [window, groupId],
  )
  const read = status === 'success'
  const rate = read
    ? measuredRate(conversion.customers, conversion.total, 'captured')
    : null
  const labelOf = (source: Aglyn.ContactSource): string =>
    Aglyn.CONTACT_SOURCE_LABELS[source] ?? source
  const sampled =
    read &&
    (window.truncated ||
      (captured.value !== null && captured.value > window.rows.length))
  const caption = sampled
    ? `Read from the ${window.rows.length.toLocaleString()} most recently captured contacts` +
      (captured.value !== null ? ` of ${captured.value.toLocaleString()}` : '') +
      ' in the period; the captured tile is counted on the server.'
    : undefined

  return (
    <CardDisplay
      header={'Conversion by source'}
      help={Aglyn.pluginDocsHelp('crmReports', {
        anchor: '#conversion-by-source',
        excerpt:
          'Of the people each capture surface brought in during the ' +
          'period, how many are customers now — at the customer stage or ' +
          'past it, or with an order on the books. Read through this ' +
          'site’s own view of each person.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
          <ReportStatTile
            label={'Captured'}
            value={captured.value !== null ? captured.value.toLocaleString() : null}
            note={'in the period, counted on the server'}
            href={routes.section('contacts')}
          />
          <ReportStatTile
            label={'Now customers'}
            value={read ? conversion.customers.toLocaleString() : null}
            note={'of those captured'}
          />
          <ReportStatTile
            label={'Conversion'}
            value={rate ? percent(rate.value) : null}
            note={
              rate
                ? `${rate.numerator.toLocaleString()} of ${rate.denominator.toLocaleString()} ${rate.denominatorLabel}`
                : read
                  ? 'nobody captured in the period'
                  : undefined
            }
          />
        </Stack>
        {captured.status === 'error' || status === 'error' ? (
          <Alert severity="warning">{'The period’s contacts could not be read.'}</Alert>
        ) : null}
        <Section title={'By source'}>
          {conversion.rows.length ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  {COLUMNS.map((column, index) => (
                    <TableCell key={column} align={index ? 'right' : 'left'}>
                      {column}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {conversion.rows.map((row) => (
                  <TableRow key={row.source}>
                    <TableCell>{labelOf(row.source)}</TableCell>
                    <TableCell align="right">{row.captured.toLocaleString()}</TableCell>
                    <TableCell align="right">{row.customers.toLocaleString()}</TableCell>
                    <TableCell align="right">{percent(row.rate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {status === 'loading' ? 'Reading…' : 'Nobody captured in this period.'}
            </Typography>
          )}
          {conversion.rows.length ? (
            <Typography variant="caption" color="text.secondary">
              {'A person captured two ways counts under both.' +
                (conversion.unsourced
                  ? ` ${conversion.unsourced.toLocaleString()} with no source on this site are counted in the tiles only.`
                  : '')}
            </Typography>
          ) : null}
          <ReportExport
            filename={reportFilename('conversion-by-source', period)}
            columns={COLUMNS}
            rows={() =>
              conversion.rows.map((row) => [
                labelOf(row.source),
                row.captured,
                row.customers,
                percent(row.rate),
              ])
            }
            disabled={!read || !conversion.rows.length}
            caption={caption}
          />
        </Section>
      </Stack>
    </CardDisplay>
  )
}
SourceConversionCard.displayName = 'SourceConversionCard'

export default SourceConversionCard
