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

import * as CommerceModel from '../../model'
import { checkEntitlement } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Alert, Box, Stack, Typography } from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import {
  useConsoleHostRoute,
  useFirestore,
  useOrgPlan,
} from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'

export interface CommerceAnalyticsCardProps {
  hostId: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

/**
 * Commerce analytics (AGL-327): revenue trend (14 days), order count,
 * AOV, channel split, and top products computed from the loaded order
 * window; storefront GA4 events mirror the funnel into the site's own
 * Google Analytics.
 *
 * Gated on `commerceAnalytics` since AGL-2056. AGL-1938 made that flag
 * non-inert by gating `CommerceGlanceCard` — the dashboard WIDGET — and
 * stopped there, leaving this, the actual Analytics tab, open to every
 * plan. `commerce` is true from Starter; `commerceAnalytics` is false
 * until Pro, so a Starter org read the widget's upgrade prompt and then
 * found the whole paid surface one tab over.
 *
 * The gate is client-side because it has to be: the numbers are derived
 * from `hosts/{hostId}/orders`, which this org may legitimately read, so
 * there is no server boundary to put it behind. That makes it a packaging
 * claim rather than a security one — which is exactly why it has to be
 * applied at EVERY surface or the claim is simply untrue.
 */
export function CommerceAnalyticsCard(props: CommerceAnalyticsCardProps) {
  const { hostId } = props
  // Console routes are /[orgSlug]/hosts/[subdomain]/… (AGL-673); this
  // component only has a host doc id.
  const consoleRoute = useConsoleHostRoute(hostId)
  const { org, ready: orgReady } = useOrgPlan(hostId)
  const entitled = checkEntitlement(org as never, 'commerceAnalytics')
  const firestore = useFirestore()
  const { data: orderDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'orders'), limit(500)),
    [firestore, hostId],
    { idField: '$id' },
  )

  const stats = useMemo(() => {
    const now = Date.now()
    const orders = (orderDocs ?? [])
      .map((order: any) => ({
        ...CommerceModel.liftLegacyOrder(order),
        createdAtMs:
          order.createdAtMs ?? (order.createdAt?.seconds ?? 0) * 1000,
      }))
      .filter(
        (order: any) =>
          !['pending', 'cancelled'].includes(order.status),
      )
    const paidCents = (order: any) =>
      (order.totals?.totalCents ?? order.amountCents ?? 0) -
      (order.refundedCents ?? 0)
    const window30 = orders.filter(
      (order: any) => now - order.createdAtMs < 30 * DAY_MS,
    )
    const revenue30 = window30.reduce(
      (sum: number, order: any) => sum + paidCents(order),
      0,
    )
    const days = Array.from({ length: 14 }, (_item, index) => {
      const dayStart = now - (13 - index) * DAY_MS
      const cents = orders
        .filter(
          (order: any) =>
            order.createdAtMs >= dayStart - (dayStart % DAY_MS) &&
            order.createdAtMs < dayStart - (dayStart % DAY_MS) + DAY_MS,
        )
        .reduce((sum: number, order: any) => sum + paidCents(order), 0)
      return cents
    })
    const channels: Record<string, number> = {}
    for (const order of window30) {
      const channel = order.channel ?? 'online'
      channels[channel] = (channels[channel] ?? 0) + paidCents(order)
    }
    const productCents = new Map<string, { name: string; cents: number }>()
    for (const order of window30) {
      for (const line of order.lineItems ?? []) {
        const entry = productCents.get(line.productId) ?? {
          name: line.name,
          cents: 0,
        }
        entry.cents += line.unitAmountCents * line.quantity
        productCents.set(line.productId, entry)
      }
    }
    const topProducts = [...productCents.values()]
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 5)
    return {
      revenue30,
      orders30: window30.length,
      aov: window30.length ? Math.round(revenue30 / window30.length) : 0,
      days,
      channels,
      topProducts,
    }
  }, [orderDocs])

  const maxDay = Math.max(1, ...stats.days)

  if (!orgReady) {
    // `checkEntitlement(undefined)` resolves the FREE tier rather than
    // "unknown" (see `useOrgPlan`), and this card's "no" is an upsell —
    // never accuse a paying org of being unentitled while the plan doc is
    // still in flight. Same three-state shape as `CommerceGlanceCard`.
    return (
      <CardDisplay
        header={'Commerce analytics (30 days)'}
        contentGutterX
        contentGutterY
      >
        <Typography variant="body2" color="text.secondary">
          {'Checking your plan…'}
        </Typography>
      </CardDisplay>
    )
  }

  if (!entitled) {
    return (
      <CardDisplay
        header={'Commerce analytics (30 days)'}
        contentGutterX
        contentGutterY
      >
        <Alert
          severity="info"
          action={
            consoleRoute.orgSlug ? (
              <AppLink
                componentVariant="button"
                color="inherit"
                size="small"
                href={`/${consoleRoute.orgSlug}/billing`}
              >
                {'Upgrade'}
              </AppLink>
            ) : undefined
          }
        >
          {'Commerce analytics — revenue trend, orders, average order ' +
            'value, channel split and top products — is a Pro feature. ' +
            'Every order is still being recorded, so the numbers are ' +
            'waiting the moment you upgrade.'}
        </Alert>
      </CardDisplay>
    )
  }

  return (
    <CardDisplay header={'Commerce analytics (30 days)'} contentGutterX contentGutterY>
      <Stack spacing={2}>
        <Stack direction="row" spacing={3}>
          {[
            ['Revenue', usd(stats.revenue30)],
            ['Orders', String(stats.orders30)],
            ['Avg order', usd(stats.aov)],
          ].map(([label, value]) => (
            <Box key={label}>
              <Typography variant="caption" color="text.secondary">
                {label}
              </Typography>
              <Typography variant="h6">{value}</Typography>
            </Box>
          ))}
        </Stack>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {'Last 14 days'}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-end', height: 56 }}>
            {stats.days.map((cents, index) => (
              <Box
                key={index}
                title={usd(cents)}
                sx={{
                  flex: 1,
                  bgcolor: 'primary.main',
                  opacity: cents ? 0.9 : 0.25,
                  borderRadius: 0.5,
                  height: `${Math.max(6, Math.round((cents / maxDay) * 100))}%`,
                }}
              />
            ))}
          </Box>
        </Box>
        <Stack direction="row" spacing={2}>
          {Object.entries(stats.channels).map(([channel, cents]) => (
            <Typography key={channel} variant="body2" color="text.secondary">
              {`${channel}: ${usd(cents)}`}
            </Typography>
          ))}
        </Stack>
        {stats.topProducts.length ? (
          <Box>
            <Typography variant="caption" color="text.secondary">
              {'Top products'}
            </Typography>
            {stats.topProducts.map((product) => (
              <Stack key={product.name} direction="row" spacing={1}>
                <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                  {product.name}
                </Typography>
                <Typography variant="body2">{usd(product.cents)}</Typography>
              </Stack>
            ))}
          </Box>
        ) : null}
        <Typography variant="caption" color="text.secondary">
          {'Storefront funnel events (view_item, add_to_cart, ' +
            'begin_checkout, purchase) also mirror into your Google ' +
            'Analytics when connected.'}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
CommerceAnalyticsCard.displayName = 'CommerceAnalyticsCard'

export default CommerceAnalyticsCard
