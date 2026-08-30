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

import type { FormFieldDecl, FormStats } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Figure,
  measuredRate,
  RateRow,
  Section,
} from '@aglyn/shared-ui-jsx/components/measured-figures.component'
import { Divider, Stack, Typography } from '@mui/material'
import { docsHelp } from '../../constants/docs-links'

export interface FormMetricsCardProps {
  /** The stored counters, or `undefined` while the document is in flight. */
  stats?: FormStats
  /** The PUBLISHED declaration — what a submission to this form can carry. */
  fields: FormFieldDecl[]
  /** Whether this form routes a submission to a lead. */
  leadRouting: boolean
  /** The form document has not arrived yet, as against having no counters. */
  loading?: boolean
}

/**
 * A number, or `null` when the field carries no number at all.
 *
 * `?? 0` is the defect this exists to avoid: a counter that has never been
 * written and a counter standing at zero are different facts, and only one of
 * them is a measurement. Everything on this card goes through here.
 */
function recorded(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * ONE FORM, MEASURED — and every rate naming its denominator.
 *
 * ## What the stored data actually supports
 *
 * A form document carries exactly three counters, and they are counters by
 * deliberate design: `/api/forms/submit` increments them on a write that was
 * happening anyway, because the alternative — counting `formSubmissions` when
 * a console surface renders — reads the one collection that grows without
 * bound and the one the customer is billed on. That decision is right, and it
 * is also the ceiling on what this card can say.
 *
 *  - `stats.submissions` — every submission ever filed under this form's id.
 *  - `stats.lastSubmissionAtMs` — when the most recent one arrived.
 *  - `stats.leads` — declared on `FormStats` and **never written**. The submit
 *    route creates a lead through `addHostLead`, files it under
 *    `source: form:{id}`, and does not count it back onto the form.
 *
 * ## What this card therefore does NOT show, and why
 *
 * Each of these was considered and is absent on purpose. An absence with a
 * reason is a smaller lie than a number with none.
 *
 *  - **Submissions over time.** Nothing per-form is stored per period. The
 *    only time series that exists is `hosts/{id}/counters/formSubmissions`,
 *    which is keyed by month and counts the SITE — it is the abuse ceiling's
 *    odometer, not a form's history. Deriving a per-form series would mean
 *    aggregating `formSubmissions` on mount, which is the expensive-read shape
 *    the counters exist to avoid.
 *  - **Completion, abandonment, or a conversion rate.** Nothing records a form
 *    being SEEN or STARTED. Every one of those rates needs a denominator of
 *    views, and no view is written anywhere, so all three would be a
 *    percentage over a population nobody counted.
 *  - **Per-field answer rates.** The values live on the submission documents
 *    in the Inbox; counting them is the same unbounded read.
 *  - **A lead rate**, until something increments `stats.leads`. It is rendered
 *    as a dash rather than dropped, so the row is already in place the day a
 *    writer appears — and so the gap is visible rather than merely missing.
 */
export function FormMetricsCard(props: FormMetricsCardProps) {
  const { stats, fields, leadRouting, loading } = props
  const submissions = recorded(stats?.submissions)
  const leads = recorded(stats?.leads)
  const lastAt = recorded(stats?.lastSubmissionAtMs)

  /*
   * The one rate this form's data could support, and it cannot yet.
   *
   * `measuredRate` returns `null` on an unrecorded numerator OR a zero
   * denominator, which is both halves of the rule at once: a form nobody has
   * submitted to has no rate, and a form whose leads were never counted has no
   * rate either. Neither is `0%`.
   *
   * The denominator is named `submissions` and not "people" on purpose. A lead
   * is created only from a submission that carried an address, so a rate over
   * every submission and a rate over the addressed ones are different numbers
   * — and this is the one the counter could actually produce.
   */
  const leadRate = measuredRate(leads, submissions, 'submissions')

  return (
    <CardDisplay
      header="What this form has collected"
      help={docsHelp('forms', {
        anchor: '#the-inbox',
        excerpt:
          'Every submission reaches the Inbox. These counters ride the same ' +
          'write, so reading them never re-counts the submissions.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
          <Figure
            label="Submissions"
            value={loading ? null : submissions}
            note="since this form was created"
          />
          <Figure
            label="Leads"
            value={leads}
            note="created from a submission"
          />
          <Figure
            label="Declared fields"
            value={fields.length}
            note="on the published design"
          />
        </Stack>
        <Divider />
        <Section title="Rates">
          <RateRow label="Submissions that became a lead" rate={leadRate} />
          {!leadRouting ? (
            <Typography variant="caption" color="text.secondary">
              {'This form does not route to leads, so there is nothing for ' +
                'that rate to be over.'}
            </Typography>
          ) : null}
        </Section>
        <Divider />
        <Section title="Most recent">
          <Typography variant="body2">
            {lastAt === null
              ? 'No submission has been recorded for this form.'
              : new Date(lastAt).toLocaleString()}
          </Typography>
        </Section>
        <Divider />
        <Section title="Not measured">
          {/*
            Named rather than omitted. A report that quietly leaves out the
            question a reader came with is indistinguishable from one that
            answered it badly.
          */}
          <Stack component="ul" sx={{ pl: 2, m: 0 }} spacing={0.5}>
            <Typography component="li" variant="caption" color="text.secondary">
              {'Submissions over time — nothing per-form is stored per period. ' +
                'The only monthly counter belongs to the site, not to one form.'}
            </Typography>
            <Typography component="li" variant="caption" color="text.secondary">
              {'Completion and abandonment — nothing records this form being ' +
                'seen or started, so there is no population to divide by.'}
            </Typography>
            <Typography component="li" variant="caption" color="text.secondary">
              {'Leads created — the submit route files a lead under this ' +
                'form and does not count it back, so the figure above is a ' +
                'dash rather than a zero.'}
            </Typography>
          </Stack>
        </Section>
      </Stack>
    </CardDisplay>
  )
}
FormMetricsCard.displayName = 'FormMetricsCard'

export default FormMetricsCard
