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
import { Divider, Stack, Tooltip, Typography } from '@mui/material'
import { formPeriodSeries, formStatsWindow, pluginDocsHelp } from '@aglyn/aglyn'
import { useMemo } from 'react'

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
 * ## Where every number here comes from
 *
 * Counters on the form document, each incremented on a write that was
 * happening anyway. The alternative — counting `formSubmissions` when a
 * console surface renders — reads the one collection that grows without bound
 * and the one the customer is billed on, and it is the shape this product has
 * created repeatedly.
 *
 *  - `stats.submissions` / `stats.leads` — `/api/forms/submit`, on the single
 *    `update` it already issues per submission. `leads` counts submissions
 *    this form FILED to the site's Leads; `addHostLead` keys one person to
 *    one document, so a returning visitor's second submission is a second
 *    capture and not a second person.
 *  - `stats.views` / `stats.starts` — `/api/analytics/collect`, from the
 *    form's own beacon, in the same shape the overlay counters use.
 *  - `stats.periods` — all four again, keyed by month, riding the same
 *    writes. This is the series drawn below AND the reason the rates can be
 *    taken at all (see next).
 *
 * ## Why the rates are not lifetime over lifetime
 *
 * `submissions` has counted since the form entity existed; `views` only since
 * the beacon shipped. Dividing the lifetime totals would answer "submissions
 * ever, over views since the day we started looking" — arbitrarily wrong, and
 * wrong in the flattering direction. `formStatsWindow` sums both counters
 * over exactly the months the denominator was live for, and answers zero
 * periods when there are none, which renders as a dash.
 *
 * ## The view count is a CLIENT count, and this card says so
 *
 * A view is a beacon; a submission is a server write. A blocked beacon, a
 * browser that runs no script, a visitor who leaves before the request goes
 * out — each is a view that is missing from the denominator and a submission
 * that is present in the numerator. So a completion rate here can exceed
 * 100%, and it is printed as measured rather than clamped: a rate pinned at a
 * tidy 100% would read as a form everybody finishes.
 *
 * ## What is still NOT measured, and why
 *
 * An absence with a reason is a smaller lie than a number with none.
 *
 *  - **Per-field answer rates.** The values live on the submission documents
 *    in the Inbox, and counting them is the unbounded read every counter here
 *    exists to avoid.
 *  - **Anything before a counter started.** The series begins at the first
 *    month with a record rather than padding backwards with zeros, and the
 *    rates cover only the months their denominator was live.
 */
export function FormMetricsCard(props: FormMetricsCardProps) {
  const { stats, fields, leadRouting, loading } = props
  const submissions = recorded(stats?.submissions)
  const leads = recorded(stats?.leads)
  const views = recorded(stats?.views)
  const lastAt = recorded(stats?.lastSubmissionAtMs)

  const series = useMemo(() => formPeriodSeries(stats), [stats])
  /** The tallest month, which every bar below is drawn as a fraction of. */
  const peak = useMemo(
    () => series.reduce((high, point) => Math.max(high, point.submissions), 0),
    [series],
  )

  /*
   * `measuredRate` returns `null` on an unrecorded numerator OR a zero
   * denominator, which is both halves of the rule at once: a form nobody has
   * submitted to has no rate, and a form whose leads were never counted has
   * no rate either. Neither is `0%`.
   *
   * The denominator is named `submissions` and not "people" on purpose. A
   * lead is filed only from a submission that carried an address, so a rate
   * over every submission and a rate over the addressed ones are different
   * numbers — and this is the one the counter actually produces.
   */
  const leadRate = measuredRate(leads, submissions, 'submissions')
  /*
   * COMPLETION AND ABANDONMENT, each over the months its own denominator was
   * recorded in — never over the lifetime totals, and never over each
   * other's window. Views and starts began being counted on the same deploy
   * but they do not stay in step: a form nobody typed into has views and no
   * starts, so a shared window would silently take the abandonment rate over
   * months that recorded no start at all.
   */
  const viewWindow = formStatsWindow(stats, 'views', 'submissions')
  const startWindow = formStatsWindow(stats, 'starts', 'submissions')
  const completionRate = viewWindow.periods
    ? measuredRate(viewWindow.of, viewWindow.over, 'views')
    : null
  /*
   * Abandonment is the starts that did NOT arrive, and it is withheld — not
   * clamped — when there are more submissions than starts.
   *
   * That happens for a real reason rather than as an arithmetic edge: the
   * start is a beacon and the submission is a server write, so a visitor
   * whose beacon was blocked submits without ever having started. Clamping
   * the difference at zero would publish "nobody abandons this form" out of a
   * measurement that had gone incoherent, which is the loudest possible
   * version of the mistake this whole card is written against.
   */
  const abandonRate =
    startWindow.periods && startWindow.over >= startWindow.of
      ? measuredRate(
          startWindow.over - startWindow.of,
          startWindow.over,
          'starts',
        )
      : null

  return (
    <CardDisplay
      header="What this form has collected"
      help={pluginDocsHelp('forms', {
        anchor: '#one-forms-own-page',
        excerpt:
          'Views and starts are counted in the visitor’s browser and ' +
          'submissions on the server, and each rate covers only the months ' +
          'its denominator was recorded.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
          <Figure
            label="Views"
            value={loading ? null : views}
            note="times this form was rendered"
          />
          <Figure
            label="Submissions"
            value={loading ? null : submissions}
            note="since this form was created"
          />
          <Figure
            label="Lead captures"
            value={leads}
            note="submissions filed to Leads"
          />
          <Figure
            label="Declared fields"
            value={fields.length}
            note="on the published design"
          />
        </Stack>
        <Divider />
        <Section title="Rates">
          <RateRow label="Views that became a submission" rate={completionRate} />
          <RateRow label="Started and never submitted" rate={abandonRate} />
          <RateRow label="Submissions that became a lead" rate={leadRate} />
          {!leadRouting ? (
            <Typography variant="caption" color="text.secondary">
              {'This form does not route to leads, so there is nothing for ' +
                'that rate to be over.'}
            </Typography>
          ) : null}
          {/*
            The measurement's own shape, on the surface rather than in a
            docblock only a maintainer reads. Both facts change how the
            numbers above should be read: which months they cover, and that
            one side of them is counted in a browser.
          */}
          <Typography variant="caption" color="text.secondary">
            {'Views and starts are counted in the visitor’s browser and ' +
              'submissions on the server, so a blocked request is a view ' +
              'this misses and a submission it does not. Each rate covers ' +
              'only the months its denominator was being recorded.'}
          </Typography>
        </Section>
        <Divider />
        <Section title="Submissions by month">
          {series.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'Nothing recorded yet. The series starts at the first month ' +
                'this form collects something.'}
            </Typography>
          ) : (
            /*
              A bar per month, drawn from the counters themselves.
              Deliberately starting at the first RECORDED month rather than a
              rolling twelve: a month before the counter existed would draw as
              a confident zero, which is a claim nobody measured.
            */
            <Stack spacing={0.5}>
              {series.map((point) => (
                <Stack
                  key={point.period}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ minWidth: 64 }}
                  >
                    {point.period}
                  </Typography>
                  <Tooltip
                    title={`${point.submissions.toLocaleString()} submissions${
                      point.views
                        ? `, ${point.views.toLocaleString()} views`
                        : ''
                    }`}
                  >
                    <Stack
                      sx={{
                        height: 8,
                        borderRadius: 1,
                        bgcolor: 'primary.main',
                        // Zero keeps a hairline rather than vanishing: a row
                        // with no bar at all reads as a missing month, and a
                        // missing month is the one thing this series must
                        // never be confused with.
                        minWidth: 2,
                        width: peak
                          ? `${Math.round((point.submissions / peak) * 100)}%`
                          : 2,
                      }}
                    />
                  </Tooltip>
                  <Typography variant="caption" sx={{ minWidth: 40 }}>
                    {point.submissions.toLocaleString()}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
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
              {'Per-field answer rates — which questions people skip. The ' +
                'values live on the submission documents, and counting them ' +
                'is a read of the whole collection every time this page ' +
                'opens.'}
            </Typography>
            <Typography component="li" variant="caption" color="text.secondary">
              {'Anything before a counter started. The month series begins ' +
                'where the record begins rather than padding backwards with ' +
                'zeros, and a rate is taken only over the months its ' +
                'denominator was live.'}
            </Typography>
            <Typography component="li" variant="caption" color="text.secondary">
              {'Who abandoned, or where they stopped. A start is one signal ' +
                'per form, not per field, so this says how often a form was ' +
                'left and never which question lost the visitor.'}
            </Typography>
          </Stack>
        </Section>
      </Stack>
    </CardDisplay>
  )
}
FormMetricsCard.displayName = 'FormMetricsCard'

export default FormMetricsCard
