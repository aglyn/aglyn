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

import Divider from '@mui/material/Divider'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type * as CommerceModel from '../../../model'
import { displayMoney } from './pos-display-api'

function TotalRow({
  label,
  cents,
  currency,
  negative,
  strong,
}: {
  label: string
  cents: number
  currency?: string
  negative?: boolean
  strong?: boolean
}) {
  const variant = strong ? 'h3' : 'h6'
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Typography variant={variant} component="span">
        {label}
      </Typography>
      <Typography variant={variant} component="span">
        {negative ? `−${displayMoney(cents, currency)}` : displayMoney(cents, currency)}
      </Typography>
    </Stack>
  )
}

/**
 * The basket as the cashier builds it, with what is paid and still due.
 *
 * `totalCents` is the SALE: a tip rides beside it and never inside it (the
 * ledger's rule, `posTipCents`), and so do `paidCents` and `dueCents`. Once a
 * tip is on the sale the customer sees it as its own line and the total they
 * are actually paying under it, so the screen never reads short by the tip.
 */
export function PosDisplayCartView({
  cart,
  currency,
}: {
  cart: CommerceModel.PosDisplayCart
  currency?: string
}) {
  const tipCents = cart.tipCents ?? 0
  // The register prices tax when the cashier charges; until then the basket
  // has no tax figure, and a "Tax $0.00" row would be a promise.
  const priced = cart.dueCents != null
  return (
    <Stack spacing={2} sx={{ width: '100%' }}>
      <List aria-label="Items" sx={{ overflowY: 'auto' }}>
        {cart.lines.map((line, index) => (
          <ListItem
            key={`${index}:${line.name}`}
            divider
            secondaryAction={
              <Typography variant="h6" component="span">
                {displayMoney(line.amountCents, currency)}
              </Typography>
            }
          >
            <ListItemText
              primary={`${line.quantity} × ${line.name}`}
              secondary={line.variantLabel || undefined}
              slotProps={{
                primary: { variant: 'h6' },
                secondary: { variant: 'body1' },
              }}
            />
          </ListItem>
        ))}
      </List>
      {cart.lines.length === 0 ? (
        <Typography variant="h6" color="text.secondary" sx={{ textAlign: 'center' }}>
          Your items will show here
        </Typography>
      ) : null}
      <Stack spacing={1}>
        <TotalRow label="Subtotal" cents={cart.itemsCents} currency={currency} />
        {cart.discountCents > 0 ? (
          <TotalRow label="Discount" cents={cart.discountCents} currency={currency} negative />
        ) : null}
        {priced ? <TotalRow label="Tax" cents={cart.taxCents} currency={currency} /> : null}
        <Divider />
        {tipCents > 0 ? (
          <>
            <TotalRow label="Total" cents={cart.totalCents} currency={currency} />
            <TotalRow label="Tip" cents={tipCents} currency={currency} />
            <TotalRow
              label="Total with tip"
              cents={cart.totalCents + tipCents}
              currency={currency}
              strong
            />
          </>
        ) : (
          <TotalRow label="Total" cents={cart.totalCents} currency={currency} strong />
        )}
        {priced ? null : (
          <Typography variant="body1" color="text.secondary">
            Any tax is added when you pay.
          </Typography>
        )}
        {cart.paidCents ? (
          <TotalRow label="Paid" cents={cart.paidCents} currency={currency} />
        ) : null}
        {cart.dueCents != null && cart.paidCents ? (
          <TotalRow label="Due" cents={cart.dueCents} currency={currency} strong />
        ) : null}
      </Stack>
    </Stack>
  )
}
