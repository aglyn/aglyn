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

import { Box, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { currentMonth } from '../../utils/billing-month'

/**
 * Historical usage, read straight off the monthly rollups (AGL-1530).
 *
 * The metered-estimate card beside this one answers the CURRENT period. The
 * next question a customer asks is "is this month unusual?", and answering it
 * needs no new aggregation, no new document and no new writer: `report-usage`
 * has written `orgs/{id}/usage/{YYYY-MM}` per month since AGL-41, and rules
 * already make it org-wide-member readable. This card is a bounded read of
 * that history and nothing else.
 *
 * ## One point per MONTH — there is no daily series to plot
 *
 * Worth stating because the opposite is easy to assume from AGL-2219's
 * "in-progress sweep runs daily". It does run daily, and it OVERWRITES the
 * single `orgs/{id}/usage/{YYYY-MM}` document each time — `report-usage`'s
 * only write site is `.doc(month)`. Yesterday's reading is gone. The route
 * says so itself where it rules out a time-weighted overage basis: "a
 * time-weighted mean needs a complete daily series and months predating the
 * in-progress sweep have none".
 *
 * So the finest granularity this collection can offer is monthly. The one
 * genuinely daily source in the product is `hosts/{id}/analytics/{YYYY-MM-DD}`,
 * which covers page views only and is already charted per-site on the host
 * analytics card — it is not the billing history, and summing it across an
 * org would answer a different question from the one this card asks.
 *
 * ## What AGL-2219 DID buy this card
 *
 * The open month is not a gap. The `?month=current` sweep writes a real
 * rollup for the month in progress, stamped `stockBasis: 'in-progress'`, so
 * the current bar comes from the same document and the same arithmetic as
 * every closed bar — no second client-side estimator to disagree with the
 * invoice, which is the defect AGL-1527 was filed for. It is rendered
 * outlined rather than filled, because a month that is still accruing is not
 * comparable to one that has settled and must not read as if it were.
 *
 * ## Ordering by document id, not by the `month` field
 *
 * `orderBy('month', 'desc')` is what the staff route uses, and on a client
 * query it carries a quiet failure: Firestore EXCLUDES from an ordered query
 * any document missing the ordered field. A rollup written before `month`
 * was recorded would silently vanish from the history rather than show as
 * unrecorded. The document id IS the month (`YYYY-MM` sorts lexicographically
 * and chronologically alike), it cannot be absent, and ordering on it needs
 * no index.
 *
 * ## Null is not zero
 *
 * The same rule the staff usage table states (AGL-2321): a rollup written
 * before a meter existed recorded nothing, and drawing a zero bar there is a
 * fabricated measurement. A month with no value for the selected meter
 * renders as an explicit "not recorded" tick, never as a floor-height bar.
 */

/** How many months back to read. A bounded query — no pagination, no index. */
const HISTORY_MONTHS = 12

/**
 * The minimum number of months worth drawing.
 *
 * AGL-1530 called this out by name: before beta an org has one month of
 * history and "the chart would be a single lonely bar". A one-bar chart
 * implies a comparison it cannot support, so below this threshold the card
 * says what it is waiting for instead of drawing a shape.
 */
const MIN_MONTHS_TO_CHART = 2

interface UsageSeries {
  key: string
  label: string
  /** The rollup field this series plots. */
  field: string
  format: (value: number) => string
}

/**
 * The meters worth a trend, in the order a customer reads them.
 *
 * `billedCents` leads because it is the only one denominated in the thing
 * the page is about. The rest are the inputs that move it. Deliberately NOT
 * every field the rollup writes — `report-usage` records ~40, most of them
 * internal signals (withheld amounts, truncation flags, `meterReportBlocked`)
 * that answer an operator's question, not a customer's; the staff org-usage
 * table is where those belong and it already shows them.
 */
const SERIES: UsageSeries[] = [
  {
    key: 'billedCents',
    label: 'Metered charges',
    field: 'billedCents',
    format: (value) => `$${(value / 100).toFixed(2)}`,
  },
  {
    key: 'pageViews',
    label: 'Page views',
    field: 'pageViews',
    format: (value) => value.toLocaleString(),
  },
  {
    key: 'formSubmissions',
    label: 'Form submissions',
    field: 'formSubmissions',
    format: (value) => value.toLocaleString(),
  },
  {
    key: 'storageGb',
    label: 'Storage',
    field: 'storageGb',
    format: (value) => `${value.toFixed(2)} GB`,
  },
  {
    key: 'contactsCount',
    label: 'Contacts',
    field: 'contactsCount',
    format: (value) => value.toLocaleString(),
  },
]

export interface UsageHistoryMonth {
  /** `YYYY-MM`, taken from the document id. */
  month: string
  /** Whether the rollup describes a month still accruing (AGL-2219). */
  inProgress: boolean
  /** Raw rollup values, `null` where the meter recorded nothing. */
  values: Record<string, number | null>
}

/**
 * A meter's value for one month, or `null` when the rollup did not record it.
 *
 * A negative number is treated as unrecorded rather than clamped to zero: no
 * meter here can legitimately go below zero, so a negative is corrupt data,
 * and drawing it as `0` would state a measurement that was never taken.
 */
export function readMeter(
  data: Record<string, unknown>,
  field: string,
): number | null {
  const raw = data?.[field]
  if (typeof raw !== 'number') return null
  if (!Number.isFinite(raw)) return null
  if (raw < 0) return null
  return raw
}

/** `2026-08` → `Aug`, and `Aug '26` whenever the year turns. */
export function monthLabel(month: string, previous?: string): string {
  const [year, index] = month.split('-')
  const date = new Date(Date.UTC(Number(year), Number(index) - 1, 1))
  const short = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  const previousYear = previous ? previous.split('-')[0] : null
  return previousYear && previousYear === year
    ? short
    : `${short} '${String(year).slice(2)}`
}

export interface BillingUsageHistoryProps {
  /** The org, for its id. Absent ⇒ the card holds its loading state. */
  org?: { $id?: string } | null
}

/**
 * The read's outcome. `null` while in flight, `'unavailable'` when the query
 * failed — never an empty array, because "we could not read your history"
 * and "you have no history" are different answers and a denied read must not
 * render as the reassuring one (`feedback_loading_default_answers_a_question`).
 */
type HistoryState = UsageHistoryMonth[] | 'unavailable' | null

export function BillingUsageHistoryComponent(props: BillingUsageHistoryProps) {
  const { org } = props
  const firestore = useFirestore()
  const orgId = org?.$id
  const [history, setHistory] = useState<HistoryState>(null)
  const [seriesKey, setSeriesKey] = useState<string>(SERIES[0].key)

  useEffect(() => {
    if (!orgId) return undefined
    let active = true
    void (async () => {
      try {
        const snapshot = await getDocs(
          query(
            collection(firestore, 'orgs', orgId, 'usage'),
            orderBy(documentId(), 'desc'),
            limit(HISTORY_MONTHS),
          ),
        )
        const open = currentMonth()
        // Newest-first off the wire; the chart reads left to right, so the
        // oldest month must end up first.
        const rows: UsageHistoryMonth[] = snapshot.docs
          .map((document: any) => {
            const data = (document.data?.() ?? {}) as Record<string, unknown>
            const month = String(document.id)
            const values: Record<string, number | null> = {}
            for (const series of SERIES) {
              values[series.key] = readMeter(data, series.field)
            }
            return {
              month,
              // The rollup's own stamp is the authority; the month
              // comparison is the fallback for a document written before
              // AGL-2219 added the field.
              inProgress:
                data['stockBasis'] === 'in-progress' || month === open,
              values,
            }
          })
          .reverse()
        if (active) setHistory(rows)
      } catch {
        if (active) setHistory('unavailable')
      }
    })()
    return () => {
      active = false
    }
  }, [firestore, orgId])

  const series =
    SERIES.find((entry) => entry.key === seriesKey) ?? SERIES[0]

  if (history === null) {
    return (
      <Typography variant={'body2'} color={'text.secondary'}>
        {'Loading usage history…'}
      </Typography>
    )
  }

  if (history === 'unavailable') {
    return (
      <Typography variant={'body2'} color={'text.secondary'}>
        {'Usage history is unavailable right now.'}
      </Typography>
    )
  }

  if (history.length < MIN_MONTHS_TO_CHART) {
    return (
      <Typography variant={'body2'} color={'text.secondary'}>
        {
          'A usage trend appears here once this workspace has two months of ' +
          'billing history.'
        }
      </Typography>
    )
  }

  const recorded = history
    .map((entry) => entry.values[series.key])
    .filter((value): value is number => value !== null)
  const max = recorded.length ? Math.max(...recorded) : 0

  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        exclusive
        size={'small'}
        value={series.key}
        onChange={(_event, next) => {
          // MUI hands back `null` when the active button is clicked again.
          // Ignoring that keeps a series always selected, rather than
          // collapsing the chart to nothing.
          if (typeof next === 'string') setSeriesKey(next)
        }}
        aria-label={'Usage meter'}
        sx={{ flexWrap: 'wrap' }}
      >
        {SERIES.map((entry) => (
          <ToggleButton key={entry.key} value={entry.key}>
            {entry.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Stack
        direction={'row'}
        spacing={0.5}
        sx={{ alignItems: 'flex-end', height: 96 }}
      >
        {history.map((entry) => {
          const value = entry.values[series.key]
          const unrecorded = value === null
          const height = unrecorded
            ? 4
            : max > 0
              ? `${Math.max(4, (value / max) * 100)}%`
              : 4
          const title = unrecorded
            ? `${entry.month}: not recorded`
            : `${entry.month}: ${series.format(value)}${
                entry.inProgress ? ' (in progress)' : ''
              }`
          return (
            <Tooltip key={entry.month} title={title}>
              <Box
                data-month={entry.month}
                data-unrecorded={unrecorded ? 'true' : 'false'}
                data-in-progress={entry.inProgress ? 'true' : 'false'}
                aria-label={title}
                sx={{
                  flex: 1,
                  height,
                  borderRadius: 0.5,
                  // An in-progress month is outlined, not filled: it is still
                  // accruing and is not comparable to a settled month.
                  bgcolor: unrecorded
                    ? 'action.disabledBackground'
                    : entry.inProgress
                      ? 'transparent'
                      : 'primary.main',
                  border: entry.inProgress ? '1px dashed' : undefined,
                  borderColor: entry.inProgress ? 'primary.main' : undefined,
                }}
              />
            </Tooltip>
          )
        })}
      </Stack>

      <Stack direction={'row'} spacing={0.5}>
        {history.map((entry, index) => (
          <Typography
            key={entry.month}
            variant={'caption'}
            color={'text.secondary'}
            sx={{ flex: 1, textAlign: 'center' }}
          >
            {monthLabel(entry.month, history[index - 1]?.month)}
          </Typography>
        ))}
      </Stack>

      {history.some((entry) => entry.inProgress) ? (
        <Typography variant={'caption'} color={'text.secondary'}>
          {'The dashed bar is the month in progress and is still accruing.'}
        </Typography>
      ) : null}
    </Stack>
  )
}

export default BillingUsageHistoryComponent
