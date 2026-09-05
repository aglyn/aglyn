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

import { deltaPercent, pluginDocsHelp, weekBuckets } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Section } from '@aglyn/shared-ui-jsx/components/measured-figures.component'
import { Alert, Stack, Typography } from '@mui/material'
import { getCountFromServer, query, Timestamp, where } from 'firebase/firestore'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { ReportBarChart } from './report-bar-chart'
import { weekLabel } from './report-format'
import {
  type CrmReportScope,
  scopedCollection,
  visibleToClause,
} from './report-scope'
import { ReportStatTile } from './report-stat-tile'
import { type AggregateRead, useAggregateRead } from './use-aggregate-read'

export interface ContactsTrendCardProps {
  report: CrmReportScope
  /** The section's one count of every contact this reader may see. */
  totalContacts: AggregateRead<number>
}

interface ContactsTrend {
  /** New contacts in the period — the sum of the weeks. */
  current: number
  /** New contacts in the period before it. */
  previous: number
  weekly: Array<{ start: number; end: number; count: number }>
}

/**
 * New contacts over the period, against the period before, week by week
 * (AGL-2604).
 *
 * ## Every number here is a server count
 *
 * One `getCountFromServer` per week of the period and one for the previous
 * period — fourteen reads for ninety days, billed as index entries rather
 * than documents — and NO document is downloaded to be counted. The period
 * figure is the sum of its weeks rather than a fifteenth read, so the tile
 * and the bars cannot disagree. The contacts list's head-count learned the
 * same lesson (AGL-1706): a count taken from a capped listener saturates at
 * the cap, and the org this page is for is the one with more contacts than
 * any listener should carry.
 *
 * The range is on `createdAt`, the timestamp every contact writer stamps —
 * the server upsert with `serverTimestamp()`, the console's add-by-hand with
 * a `Date` — so "new" means first captured, not last touched.
 */
export function ContactsTrendCard(props: ContactsTrendCardProps) {
  const { report, totalContacts } = props
  const { scope, tokens, range, routes } = report
  const firestore = useFirestore()

  const trend = useAggregateRead<ContactsTrend>(() => {
    const contacts = scopedCollection(firestore, scope, 'contacts')
    const createdBetween = (from: number, to: number) =>
      getCountFromServer(
        query(
          contacts,
          visibleToClause(tokens),
          where('createdAt', '>=', Timestamp.fromMillis(from)),
          where('createdAt', '<', Timestamp.fromMillis(to)),
        ),
      ).then((snapshot) => snapshot.data().count)
    const buckets = weekBuckets(range.from, range.to)
    return Promise.all([
      createdBetween(range.previousFrom, range.previousTo),
      ...buckets.map((bucket) => createdBetween(bucket.start, bucket.end)),
    ]).then(([previous, ...weekly]) => ({
      previous,
      current: weekly.reduce((sum, count) => sum + count, 0),
      weekly: buckets.map((bucket, index) => ({
        ...bucket,
        count: weekly[index] ?? 0,
      })),
    }))
  }, [firestore, scope, tokens, range])

  const figures = trend.value
  return (
    <CardDisplay
      header={'Contacts'}
      help={pluginDocsHelp('crmReports', {
        anchor: '#contacts',
        excerpt:
          'New contacts in the period against the period before it, week ' +
          'by week, and how many contacts this site can see in all. Counted ' +
          'on the server by when each contact was first captured.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
          <ReportStatTile
            label={'New contacts'}
            value={figures ? figures.current.toLocaleString() : null}
            deltaPct={figures ? deltaPercent(figures.current, figures.previous) : null}
            note={
              figures
                ? figures.previous
                  ? `${figures.previous.toLocaleString()} in the previous period`
                  : 'none in the previous period'
                : undefined
            }
            href={routes.section('contacts')}
          />
          <ReportStatTile
            label={'Total contacts'}
            value={
              totalContacts.value === null
                ? null
                : totalContacts.value.toLocaleString()
            }
            note={'visible to this site'}
            href={routes.section('contacts')}
          />
        </Stack>
        {trend.status === 'error' || totalContacts.status === 'error' ? (
          <Alert severity="warning">
            {'The contact counts could not be read. The rest of the page is unaffected.'}
          </Alert>
        ) : null}
        <Section title={'New contacts per week'}>
          <ReportBarChart
            labels={(figures?.weekly ?? []).map((week) => weekLabel(week.start))}
            series={[
              {
                name: 'New contacts',
                color: 'primary.main',
                values: (figures?.weekly ?? []).map((week) => week.count),
              },
            ]}
            emptyText={
              trend.status === 'loading' ? 'Counting…' : 'Nothing in this period.'
            }
          />
          <Typography variant="caption" color="text.secondary">
            {'Each bar is seven days from the start of the period; the last ' +
              'may be shorter.'}
          </Typography>
        </Section>
      </Stack>
    </CardDisplay>
  )
}
ContactsTrendCard.displayName = 'ContactsTrendCard'

export default ContactsTrendCard
