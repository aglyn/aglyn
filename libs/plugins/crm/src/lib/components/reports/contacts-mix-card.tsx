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
  percent,
  Section,
} from '@aglyn/shared-ui-jsx/components/measured-figures.component'
import { Alert, Stack, Typography } from '@mui/material'
import { limit, orderBy, query } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { contactPrimaryGroup } from '../../model/contact-record'
import { ReportBreakdown } from './report-breakdown'
import { plural } from './report-format'
import {
  type CrmReportScope,
  reportCacheKey,
  scopedCollection,
  visibleToClause,
} from './report-scope'
import { type AggregateRead, useWindowRead } from './use-aggregate-read'

/**
 * How many contacts the source mix and the funnel are read from.
 *
 * These two charts need a FIELD off each contact — which facet sources it
 * carries, which lifecycle stage — and Firestore aggregates cannot group by
 * a map key, so the only way to draw them is to read documents. A thousand
 * is the same bound the contacts list carries, and past it the card SAYS it
 * is a sample rather than quietly drawing a thousand as if it were the org.
 */
const CONTACT_SAMPLE_CEILING = 1000

export interface ContactsMixCardProps {
  report: CrmReportScope
  /** The section's count of every contact this reader may see — what decides whether the read is a sample. */
  totalContacts: AggregateRead<number>
}

/**
 * Contacts by source, and the lifecycle funnel, from the newest thousand
 * contacts (AGL-2604).
 *
 * Both are read through THIS group's facet, the way every other field on
 * the contacts page is: a source is which capture surface this holder saw
 * the person through, and a stage is where this business's sales team put
 * them. Reading either off the top of the document would chart another
 * holder's records — the disclosure the facet shape exists to end.
 *
 * Newest by `createdAt` rather than by `updatedAt`, so that the sample is
 * "the last thousand people captured" — a population a reader can reason
 * about — and not "the thousand most recently edited", which is whichever
 * ones a bulk tag touched last.
 */
export function ContactsMixCard(props: ContactsMixCardProps) {
  const { report, totalContacts } = props
  const { scope, tokens, groupId, org, nowMs } = report
  const firestore = useFirestore()

  const sample = useWindowRead<Record<string, unknown>>(
    () =>
      query(
        scopedCollection(firestore, scope, 'contacts'),
        ...visibleToClause(tokens),
        orderBy('createdAt', 'desc'),
        limit(CONTACT_SAMPLE_CEILING + 1),
      ),
    CONTACT_SAMPLE_CEILING,
    [firestore, scope, tokens, nowMs],
    { cacheKey: reportCacheKey(report, 'contacts:sample') },
  )
  const status = sample.status

  const mix = useMemo(() => {
    // Through the viewing group's facet under a site; at the organization
    // level (AGL-2630) through each person's own primary holder, so the mix
    // is of the profiles the capturing sites keep.
    const facets = sample.rows.map((row) =>
      Aglyn.readContactFacet(
        row,
        groupId ?? contactPrimaryGroup(row, org).groupId,
      ),
    )
    // A person captured two ways counts under both sources: the chart asks
    // "how many people came through each door", and a person who came
    // through two did.
    const sources = Aglyn.tally(
      facets.flatMap((facet) =>
        (Object.keys(facet.sources) as Aglyn.ContactSource[]).filter(
          (source) => facet.sources[source],
        ),
      ),
      (source) => source,
    )
    const stageCounts: Partial<Record<Aglyn.ContactLifecycleStage, number>> = {}
    let unstaged = 0
    for (const facet of facets) {
      const stage = facet.lifecycleStage
      if (Aglyn.isContactLifecycleStage(stage)) {
        stageCounts[stage] = (stageCounts[stage] ?? 0) + 1
      } else {
        unstaged += 1
      }
    }
    return { sources, funnel: Aglyn.funnelFromStages(stageCounts), unstaged }
  }, [sample, groupId, org])

  // A sample only once the read has settled: while the window is empty
  // every org "exceeds" zero rows.
  const sampled =
    status === 'success' &&
    (sample.truncated ||
      (totalContacts.value !== null && totalContacts.value > sample.rows.length))

  return (
    <CardDisplay
      header={'Sources and lifecycle'}
      help={Aglyn.pluginDocsHelp('crmReports', {
        anchor: '#sources-and-lifecycle',
        excerpt:
          'Which capture surfaces your contacts came through, and how many ' +
          'have reached each lifecycle stage. Read from the newest thousand ' +
          'contacts, through this site’s own view of each person.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {sampled ? (
          <Alert severity="info">
            {`Read from the newest ${sample.rows.length.toLocaleString()} contacts${
              totalContacts.value !== null
                ? ` of ${totalContacts.value.toLocaleString()}`
                : ''
            } — a sample, not the whole list.`}
          </Alert>
        ) : null}
        <Section title={'By source'}>
          <ReportBreakdown
            rows={mix.sources.map((row) => ({
              key: row.key,
              label:
                Aglyn.CONTACT_SOURCE_LABELS[row.key as Aglyn.ContactSource] ??
                row.key,
              value: row.count,
            }))}
            emptyText={
              status === 'loading' ? 'Reading…' : 'No contacts to count yet.'
            }
          />
          {mix.sources.length ? (
            <Typography variant="caption" color="text.secondary">
              {'A person captured two ways counts under both.'}
            </Typography>
          ) : null}
        </Section>
        <Section title={'Lifecycle funnel'}>
          <ReportBreakdown
            rows={mix.funnel.steps.map((step) => ({
              key: step.stage,
              label: step.label,
              value: step.reached,
              note:
                `${plural(step.count, 'person', 'people')} here now` +
                (step.conversion === null
                  ? ''
                  : ` · ${percent(step.conversion)} of the step before`),
            }))}
            emptyText={
              status === 'loading' ? 'Reading…' : 'No contacts to place yet.'
            }
          />
          {sample.rows.length ? (
            <Typography variant="caption" color="text.secondary">
              {`Each step counts everyone who reached it or went further. ${plural(
                mix.unstaged,
                'contact',
              )} with no stage yet · ${mix.funnel.other.toLocaleString()} marked other.`}
            </Typography>
          ) : null}
        </Section>
      </Stack>
    </CardDisplay>
  )
}
ContactsMixCard.displayName = 'ContactsMixCard'

export default ContactsMixCard
