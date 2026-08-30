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

/*
 * The four figure primitives now live in `@aglyn/shared-ui-jsx` so the forms
 * report and the email reports share one implementation of "a rate names its
 * denominator". Re-exported here because the email cards import them from
 * this path, and a rate that renders differently on two surfaces is the thing
 * the shared copy exists to prevent.
 */
export {
  Figure,
  percent,
  RateRow,
  Section,
  type MeasuredRate,
} from '@aglyn/shared-ui-jsx/components/measured-figures.component'

import { Stack, Typography } from '@mui/material'
import type { CampaignMoneyPerMessage } from '../model/campaign-revenue'
import { percent as sharedPercent } from '@aglyn/shared-ui-jsx/components/measured-figures.component'

/*
 * Money stays here. It is not a figure primitive: it carries a currency, and
 * this surface deliberately refuses to sum two of them into one number.
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
