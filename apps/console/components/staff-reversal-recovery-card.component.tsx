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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Alert, Stack, Typography } from '@mui/material'
import { docsHelp } from '../constants/docs-links'

/** One refused reversal, as `/api/admin/overview` projects it. */
export interface ReversalRecoveryRow {
  $id: string
  listingId: string | null
  sellerOrgId: string | null
  /**
   * The seller's workspace by NAME, resolved by `/api/admin/overview` from
   * the org snapshot it already holds. Null when the route could not name it
   * — an org outside the capped snapshot, or one since deleted — and the row
   * then falls back to the id, which is still a lead somebody can search.
   */
  sellerOrgLabel?: string | null
  buyerUid: string | null
  /** What the webhook failed to pull back. 0 when it never learned the amount. */
  owedCents: number
  reason: string | null
  cause: string | null
  failedAt: number | null
}

/**
 * The refund-reversal recovery queue (AGL-2309) — money owed to Aglyn.
 *
 * `libs/plugins/marketplace/src/lib/server/billing-webhook.ts` stamps
 * `reversalFailedAt` / `reversalFailedReason` / `reversalOwedCents` onto a
 * purchase when Stripe DEFINITIVELY refuses to reverse the publisher's
 * transfer after a buyer refund. `balance_insufficient` on a connected
 * account is a **400**: it does not throw, so the webhook does not redeliver,
 * and the settle marker makes the abandonment permanent. The buyer is made
 * whole, the publisher keeps their 80%, and Aglyn absorbs the gross.
 *
 * That writer's own comment named the queue —
 * `where('reversalFailedAt', '!=', null)` — and the query did not exist
 * anywhere in the repo. Every refusal was therefore recorded precisely so a
 * human could chase it, and unreachable by any human. `netPaidCents` in
 * `seller-ledger-totals.ts` deliberately does not count the owed amount
 * either (it sums the reversal that ACTUALLY happened, which is the honest
 * reading there), so the publisher panel could not surface it as a side
 * effect.
 *
 * Presentational on purpose: the overview route already holds the purchase
 * documents, so a second fetch would be a second, disagreeing read of the
 * same money. The header carries the TOTAL because the first staff question
 * is "how much", and the per-row amount is what makes any of it chaseable.
 */
export default function StaffReversalRecoveryCard({
  rows,
  owedCents,
}: {
  rows: readonly ReversalRecoveryRow[] | null | undefined
  owedCents: number | null | undefined
}) {
  const queue = rows ?? []
  const total = Number(owedCents ?? 0)
  return (
    <CardDisplay
      header={
        'Refund reversals to recover' +
        (total > 0 ? ` — $${(total / 100).toFixed(2)}` : '')
      }
      help={docsHelp('publisherHandbook', {
        anchor: '#getting-paid',
        excerpt:
          'Refunded sales where Stripe refused to pull the publisher’s ' +
          'share back — the publisher kept it and Aglyn absorbed the gross ' +
          'until it is recovered.',
      })}
      contentGutterX
      contentGutterY
    >
      {queue.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'Nothing outstanding — every refunded sale pulled the publisher’s ' +
            'share back.'}
        </Typography>
      ) : (
        <Stack spacing={0.5}>
          <Alert severity="warning">
            {`${queue.length} refunded ${
              queue.length === 1 ? 'sale' : 'sales'
            } left the publisher’s share in place. Recover it from the ` +
              'connected account, then clear the fields on the purchase.'}
          </Alert>
          {queue.map((row) => (
            <Stack
              key={row.$id}
              direction="row"
              sx={{ justifyContent: 'space-between' }}
            >
              <Typography variant="body2" noWrap sx={{ maxWidth: '45%' }}>
                {row.listingId ?? row.$id}
              </Typography>
              {/*
               * The owed amount FIRST. This card exists because the money was
               * unfindable; the reason only becomes useful once the amount is
               * legible.
               *
               * `owedCents: 0` is a refusal whose amount the webhook never
               * learned — the `no-charge-on-cause` and `no-transfer` branches
               * settle without one — and it says so rather than rendering
               * "$0.00", which would read as "nothing owed" on a row that is
               * on this queue precisely because something is.
               */}
              <Typography variant="caption" color="text.secondary">
                {(row.owedCents > 0
                  ? `$${(row.owedCents / 100).toFixed(2)} owed`
                  : 'amount unknown') +
                  ` · ${row.reason ?? 'unknown reason'}` +
                  ` · ${row.cause ?? 'unknown cause'}` +
                  ` · seller ${
                    row.sellerOrgLabel ?? row.sellerOrgId ?? 'unknown'
                  }` +
                  ` · ${
                    row.failedAt
                      ? new Date(row.failedAt).toLocaleDateString()
                      : '—'
                  }`}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </CardDisplay>
  )
}

StaffReversalRecoveryCard.displayName = 'StaffReversalRecoveryCard'
