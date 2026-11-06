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

import * as CommerceModel from '../model'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import MuiLink from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

export interface AccountSubscription {
  id: string
  productName: string
  status: string
  currentPeriodEndMs?: number | null
  paidThroughMs?: number
  cancelAtPeriodEnd?: boolean
  priceCents?: number
  interval?: string
  invoices?: Array<{
    id: string
    paidAtMs: number
    paidCents: number
    currency: string
    number?: string
    url?: string
  }>
}

export interface AccountSubscriptionsProps {
  hostId: string
  subscriptions: AccountSubscription[]
  siteFetch: (input: string, init?: RequestInit) => Promise<Response>
}

/**
 * The account page's Subscriptions section (AGL-303, AGL-4191): each
 * subscription's price, the next date that matters, Manage (Stripe's billing
 * page) and its billing history. Its own module so the storefront's first
 * download does not carry it; the account block loads it once a signed-in
 * member has subscriptions to show.
 */
export function AccountSubscriptions(props: AccountSubscriptionsProps) {
  const { hostId, subscriptions, siteFetch } = props
  /** The subscription whose billing history is open. */
  const [openHistory, setOpenHistory] = useState<string | null>(null)
  return (
    <>
      <Divider textAlign="left">{'Subscriptions'}</Divider>
    {subscriptions.map((subscription) => {
      const invoices = subscription.invoices ?? []
      const currency = invoices[0]?.currency ?? 'USD'
      const dateLine = CommerceModel.subscriptionDateLine(subscription)
      // Says what to do about it: Manage opens Stripe's billing page,
      // where the card is updated (AGL-4191).
      const dateText =
        dateLine?.kind === 'paymentFailed'
          ? 'Payment failed. Update your card with Manage.'
          : CommerceModel.subscriptionDateText(dateLine)
      const price =
        subscription.priceCents != null
          ? `${CommerceModel.formatOrderMoney(subscription.priceCents, currency)}${CommerceModel.subscriptionIntervalSuffix(subscription.interval)}`
          : ''
      const historyOpen = openHistory === subscription.id
      return (
        <Box key={subscription.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {subscription.productName}
              </Typography>
              {price || dateText ? (
                <Typography variant="caption" color="text.secondary">
                  {[price, dateText].filter(Boolean).join(' · ')}
                </Typography>
              ) : null}
            </Box>
            <Chip
              label={CommerceModel.subscriptionStatusLabel(subscription.status)}
              size="small"
              variant="outlined"
              color={CommerceModel.subscriptionStatusColor(subscription.status)}
            />
            <Button
              size="small"
              onClick={async () => {
                const response = await siteFetch(
                  '/api/commerce/subscription-portal',
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hostId }),
                  },
                ).catch(() => null)
                const payload = await response?.json().catch(() => ({}))
                if (payload?.url) window.location.assign(payload.url)
              }}
            >
              {'Manage'}
            </Button>
          </Box>
          {invoices.length > 0 ? (
            <Box>
              <Button
                size="small"
                aria-expanded={historyOpen}
                onClick={() => setOpenHistory(historyOpen ? null : subscription.id)}
                sx={{ px: 0 }}
              >
                {historyOpen ? 'Hide billing history' : `Billing history (${invoices.length})`}
              </Button>
              {historyOpen
                ? invoices.map((invoice) => (
                    <Box
                      key={invoice.id}
                      sx={{ display: 'flex', gap: 1, alignItems: 'center', py: 0.25 }}
                    >
                      <Typography variant="caption" sx={{ flex: 1, minWidth: 0 }} noWrap>
                        {CommerceModel.formatSubscriptionDate(invoice.paidAtMs)}
                        {invoice.number ? ` · ${invoice.number}` : ''}
                      </Typography>
                      <Typography variant="caption">
                        {CommerceModel.formatOrderMoney(invoice.paidCents, invoice.currency)}
                      </Typography>
                      {invoice.url ? (
                        <MuiLink
                          href={invoice.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="caption"
                          underline="hover"
                        >
                          {'Invoice'}
                        </MuiLink>
                      ) : null}
                    </Box>
                  ))
                : null}
            </Box>
          ) : null}
        </Box>
      )
    })}
    </>
  )
}
AccountSubscriptions.displayName = 'AccountSubscriptions'

export default AccountSubscriptions
