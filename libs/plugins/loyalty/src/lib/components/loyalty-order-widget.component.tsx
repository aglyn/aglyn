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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { LOYALTY_API_ROUTES } from '../constants/api-routes'
import { formatLoyaltyCents, formatPoints } from '../model/loyalty-math'
import type { LoyaltyOrderView } from '../model/loyalty-member'
import { useLoyaltyFetch } from './loyalty-api'

/** What `orderDetail` hands a widget, as far as this one reads it. */
export interface LoyaltyOrderWidgetProps {
  hostId: string
  order: { id: string; currency?: string }
}

/**
 * REWARDS on an order (AGL-3640): the points it earned and any a refund took
 * back, and the rewards it spent and any a refund gave back. Draws nothing for
 * an order rewards never touched.
 */
export function LoyaltyOrderWidget(props: LoyaltyOrderWidgetProps) {
  const { hostId, order } = props
  const request = useLoyaltyFetch()
  const [view, setView] = useState<LoyaltyOrderView | null>(null)

  useEffect(() => {
    if (!order?.id) return
    let live = true
    request<{ order: LoyaltyOrderView }>(LOYALTY_API_ROUTES.order, { query: { hostId, orderId: order.id } })
      .then((answer) => live && setView(answer.order))
      .catch(() => live && setView(null))
    return () => {
      live = false
    }
  }, [hostId, order?.id, request])

  if (!view || (!view.earnedPoints && !view.spentCents && !view.entries.length)) return null
  const currency = order.currency ?? 'usd'
  return (
    <CardDisplay
      header="Rewards"
      help={pluginDocsHelp('loyalty', {
        anchor: '#on-an-order',
        excerpt: 'The points this order earned and the rewards it spent, and what refunds changed.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={0.5} data-testid="loyalty-order-widget">
        {view.earnedPoints ? (
          <Typography variant="body2">
            {`Earned ${formatPoints(view.earnedPoints)} points${view.email ? ` for ${view.email}` : ''}${
              view.reversedPoints ? `, ${formatPoints(view.reversedPoints)} taken back by refunds` : ''
            }`}
          </Typography>
        ) : null}
        {view.spentCents ? (
          <Typography variant="body2">
            {`Paid ${formatLoyaltyCents(view.spentCents, currency)} with rewards (${[
              view.spentCreditCents ? `${formatLoyaltyCents(view.spentCreditCents, currency)} store credit` : '',
              view.spentPoints ? `${formatPoints(view.spentPoints)} points` : '',
            ]
              .filter(Boolean)
              .join(' and ')})${view.restoredCents ? `, ${formatLoyaltyCents(view.restoredCents, currency)} given back` : ''}`}
          </Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}

export default LoyaltyOrderWidget
