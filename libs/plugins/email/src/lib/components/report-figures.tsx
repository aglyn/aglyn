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
