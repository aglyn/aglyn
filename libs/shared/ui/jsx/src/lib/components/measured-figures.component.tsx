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
 * THE THREE WAYS A MEASURED NUMBER IS ALLOWED TO REACH A SCREEN.
 *
 * Every reporting surface in this product renders the same three things — a
 * titled block, a count, and a rate — and each carries a rule that is easy to
 * state and easy to lose:
 *
 *  - **A count that is `null` draws a dash, never a zero.** "We have no
 *    record of this" and "this happened zero times" lead a reader to opposite
 *    conclusions, and a zero renders the first as the second.
 *  - **A rate prints its denominator on the same line as its percentage.**
 *    An open rate over `sent` and one over `delivered` are different numbers
 *    sharing a label; a reader comparing two rates must be able to see they
 *    are over different populations without hovering anything. The same
 *    ambiguity exists wherever a rate is quoted — a form's lead rate over
 *    submissions and over submissions that carried an address differ by
 *    however many people declined to give one.
 *  - **A rate that cannot be divided draws a dash and no number.** There is
 *    no branch here that substitutes a denominator to get something
 *    printable.
 *
 * They live in one module because a second copy is a second chance to render
 * a percentage without its denominator — and the copy would be written by
 * whoever adds the next card, in a file nobody tests for it.
 *
 * MONEY joined them (AGL-3080), from the campaign lib that had kept its own.
 * It is not a fourth way of measuring — it is the same two, in currency: a
 * total that draws a dash rather than a zero, and an average that names the
 * population it is over. The rule they enforce does not become someone
 * else's the moment the number has a currency on it, and the copy that was
 * left behind sat in a library only the email surfaces could reach, so the
 * next surface to show money would have written a third.
 */

import { Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

/**
 * An average in currency, together with everything needed to say what it is
 * an average OF (AGL-3080).
 *
 * {@link MeasuredRate}'s contract in money, and it goes wrong the same way:
 * "$0.42 per recipient" is meaningless without the recipient count, and worse
 * than meaningless when the reader assumes a different one from the writer.
 * Minor units throughout, because the per-message figure is fractional by
 * nature and rounding it at the model would lose the thing being measured.
 */
export interface MeasuredMoney {
  /** Minor units per unit of the denominator. Fractional by nature. */
  cents: number
  numeratorCents: number
  denominator: number
  /** Reader-facing name of the denominator, e.g. `'delivered'`. */
  denominatorLabel: string
  /** Lowercase ISO code as it was recorded, e.g. `'usd'`. */
  currency: string
}

/**
 * A rate, together with everything needed to say what it is a rate OF.
 *
 * The producer decides whether a rate can honestly be taken; a `null` in
 * place of one of these is how it says no. Nothing here formats — `value` is
 * 0–1 and the display multiplies — so a model can be tested on the number
 * without a renderer, and this file cannot invent a denominator.
 */
export interface MeasuredRate {
  /** 0–1. Multiply for display; a producer never formats. */
  value: number
  numerator: number
  denominator: number
  /** Reader-facing name of the denominator, e.g. `'delivered'`. */
  denominatorLabel: string
}

/**
 * A rate, or `null` when one cannot honestly be taken.
 *
 * `null` on a zero or unrecorded denominator. Those are not the same as 0%:
 * a rate over nothing is undefined, and printing it as zero states a measured
 * failure where there was no measurement.
 */
export function measuredRate(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  denominatorLabel: string,
): MeasuredRate | null {
  if (numerator == null || denominator == null) return null
  const top = Number(numerator)
  const bottom = Number(denominator)
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) {
    return null
  }
  return { value: top / bottom, numerator: top, denominator: bottom, denominatorLabel }
}

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
export function RateRow(props: { label: string; rate: MeasuredRate | null }) {
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
 * One amount of money, in the currency it was recorded in.
 *
 * NOT a figure primitive, and deliberately separate from {@link Figure}: it
 * carries a currency, and every surface that shows these refuses to sum two
 * of them into one number. A currency code the platform cannot format falls
 * back to the amount beside the code, which is still true, rather than
 * throwing inside a render.
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
 * The rule {@link RateRow} enforces for a percentage, applied to an average.
 * `null` draws the reason rather than a zero, for {@link Figure}'s reason.
 */
export function MoneyPerUnitRow(props: {
  label: string
  figure: MeasuredMoney | null
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
MoneyPerUnitRow.displayName = 'MoneyPerUnitRow'

/**
 * One money total, with what it counts named underneath.
 *
 * {@link Figure}'s contract in currency: `null` draws a dash and never a
 * zero, because "no attribution has ever been recorded" and "this earned
 * nothing" lead a merchant to opposite conclusions about whether to send
 * another one.
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
