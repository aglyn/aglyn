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

/**
 * THE THREE WAYS AN EMAIL NUMBER IS ALLOWED TO REACH A SCREEN.
 *
 * Every email reporting surface renders the same three things — a titled
 * block, a count, and a rate — and each carries a rule that is easy to state
 * and easy to lose:
 *
 *  - **A count that is `null` draws a dash, never a zero.** "We have no
 *    delivery events" and "nothing was delivered" lead a merchant to opposite
 *    conclusions about their sending domain, and a zero renders the first as
 *    the second.
 *  - **A rate prints its denominator on the same line as its percentage.**
 *    An open rate over `sent` and one over `delivered` are different numbers
 *    sharing a label; a reader comparing two rates must be able to see they
 *    are over different populations without hovering anything.
 *  - **A rate that cannot be divided draws a dash and no number.** There is
 *    no branch here that substitutes a denominator to get something
 *    printable.
 *
 * They live in one module because a second copy is a second chance to render
 * a percentage without its denominator — and the copy would be written by
 * whoever adds the next card, in a file nobody tests for it.
 */

import { Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import type { CampaignRate } from '../model/campaign-report'
import type { CampaignMoneyPerMessage } from '../model/campaign-revenue'

/** A titled block. */
export function Section(props: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={1}>
      <Typography variant="overline" color="text.secondary">
        {props.title}
      </Typography>
      {props.children}
    </Stack>
  )
}
Section.displayName = 'Section'

/**
 * One count, with the population it describes named underneath.
 *
 * `null` renders as an em dash and NOT as zero, which is the whole reason
 * this takes `number | null` rather than defaulting.
 */
export function Figure(props: {
  label: string
  value: number | null
  note: string
}) {
  return (
    <Stack sx={{ minWidth: 140 }}>
      <Typography variant="h6">
        {props.value === null ? '—' : props.value.toLocaleString()}
      </Typography>
      <Typography variant="body2">{props.label}</Typography>
      <Typography variant="caption" color="text.secondary">
        {props.value === null ? 'not recorded' : props.note}
      </Typography>
    </Stack>
  )
}
Figure.displayName = 'Figure'

/** A percentage to one decimal place. */
export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/**
 * One rate, with its denominator spelled out on the same line.
 *
 * The denominator is rendered as `12 of 480 delivered` rather than as a
 * tooltip or a footnote, because a reader comparing two rates has to be able
 * to see they are over different populations without hovering anything. A
 * `null` rate draws the dash and no number at all.
 */
export function RateRow(props: { label: string; rate: CampaignRate | null }) {
  const { label, rate } = props
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}
    >
      <Typography variant="body2">{label}</Typography>
      {rate ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
            {percent(rate.value)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {`${rate.numerator.toLocaleString()} of ${rate.denominator.toLocaleString()} ${rate.denominatorLabel}`}
          </Typography>
        </Stack>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {'— not enough recorded to compute'}
        </Typography>
      )}
    </Stack>
  )
}
RateRow.displayName = 'RateRow'

/**
 * Minor units, formatted in the currency they were recorded in.
 *
 * The currency is rendered from the STORED code rather than from a `$` in a
 * template literal, which is what the rest of this codebase does today. A
 * hardcoded symbol is fine while every charge is in dollars and becomes a
 * lie the moment one is not — and this surface's whole contract is that a
 * number says what it is.
 *
 * ⚠️ Minor units are divided by 100, so a zero-decimal currency (JPY, KRW)
 * would render a hundredth of its true amount. No checkout door in this repo
 * charges in one — every one of them sets `currency: 'usd'` on the Stripe line
 * items — so the case cannot arise from our own code today, and it is named
 * here rather than papered over because the day it can arise, this is the
 * line that has to change.
 *
 * A code `Intl` cannot parse falls back to the digits with the code beside
 * them. `Intl.NumberFormat` throws a `RangeError` on a MALFORMED code — one
 * that is not three letters — and a report card that throws in render takes
 * every figure on the page down with it, including the ones that were fine.
 * A well-formed code it does not recognise does not throw: it prints the code
 * as its own symbol, which is the right answer for a currency nobody has a
 * glyph for.
 */
export function money(cents: number, currency: string): string {
  const amount = cents / 100
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`
  }
}

/**
 * One money figure, with the population it is averaged over named.
 *
 * The same rule {@link RateRow} enforces for a percentage, applied to an
 * average — they go wrong the same way. "$0.42 per recipient" is meaningless
 * without the recipient count, and worse than meaningless when the reader
 * assumes a different one from the writer.
 */
export function MoneyPerMessageRow(props: {
  label: string
  figure: CampaignMoneyPerMessage | null
}) {
  const { label, figure } = props
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}
    >
      <Typography variant="body2">{label}</Typography>
      {figure ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
            {money(figure.cents, figure.currency)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {`${money(figure.numeratorCents, figure.currency)} over ${figure.denominator.toLocaleString()} ${figure.denominatorLabel}`}
          </Typography>
        </Stack>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {'— not enough recorded to compute'}
        </Typography>
      )}
    </Stack>
  )
}
MoneyPerMessageRow.displayName = 'MoneyPerMessageRow'

/**
 * One money total, with what it counts named underneath.
 *
 * {@link Figure}'s contract in currency: `null` draws a dash and never a
 * zero, because "no attribution has ever been recorded" and "this campaign
 * earned nothing" lead a merchant to opposite conclusions about whether to
 * send another one.
 */
export function MoneyFigure(props: {
  label: string
  cents: number | null
  currency: string
  note: string
}) {
  return (
    <Stack sx={{ minWidth: 140 }}>
      <Typography variant="h6">
        {props.cents === null ? '—' : money(props.cents, props.currency)}
      </Typography>
      <Typography variant="body2">{props.label}</Typography>
      <Typography variant="caption" color="text.secondary">
        {props.cents === null ? 'not recorded' : props.note}
      </Typography>
    </Stack>
  )
}
MoneyFigure.displayName = 'MoneyFigure'
