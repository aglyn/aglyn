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

import { formatOrderNumber, isLowStock, liftLegacyProduct } from '../../model'
import { checkEntitlement } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Alert, Button, Chip, Divider, Stack, Typography } from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import {
  useConsoleHostRoute,
  useFirestore,
  useOrgPlan,
} from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Commerce at a glance (AGL-353): 30-day revenue, orders, AOV, low-stock
 * count and the five latest orders. Renders nothing for hosts without a
 * catalog so non-commerce dashboards stay clean.
 *
 * The figures are the `commerceAnalytics` entitlement — `/pricing` sells
 * "Commerce analytics" as Pro-and-up, and `/product/commerce` calls it "a
 * built-in commerce analytics dashboard". Until AGL-1938 the flag was
 * inert: its ONLY occurrence outside `plan-entitlements.ts` was its own
 * type declaration, and this card carried no check, so every commerce org
 * — Starter included — got the Pro surface for free. The store link and
 * card shell stay ungated; only the measured numbers are the paid part.
 */
export function CommerceGlanceCard(props: { hostId: string }) {
  const { hostId } = props
  // Console routes are /[orgSlug]/hosts/[subdomain]/… (AGL-673); this
  // component only has a host doc id.
  const consoleRoute = useConsoleHostRoute(hostId)
  const { org, ready: orgReady } = useOrgPlan(hostId)
  const entitled = checkEntitlement(org as never, 'commerceAnalytics')
  const firestore = useFirestore()
  const { data: orderDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'orders'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: productDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'products'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )

  const summary = useMemo(() => {
    const since = Date.now() - THIRTY_DAYS_MS
    const orders = [...(orderDocs ?? [])].sort(
      (a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0),
    )
    const recentWindow = orders.filter(
      (order) =>
        (order.createdAtMs ?? 0) >= since &&
        order.status !== 'canceled' &&
        order.status !== 'refunded',
    )
    // The legacy flat `amountCents` as the fallback, matching every other
    // money reader (AGL-1747). This card had the modern read but not the
    // fallback, so a Commerce Starter order (AGL-90) rendered as $0.00.
    const revenueCents = recentWindow.reduce(
      (sum, order) =>
        sum + Number(order.totals?.totalCents ?? order.amountCents ?? 0),
      0,
    )
    const lowStock = (productDocs ?? []).filter((product: any) => {
      try {
        return isLowStock(liftLegacyProduct(product))
      } catch {
        return false
      }
    }).length
    return {
      latest: orders.slice(0, 5),
      orders30d: recentWindow.length,
      revenueCents,
      aovCents: recentWindow.length
        ? Math.round(revenueCents / recentWindow.length)
        : 0,
      lowStock,
    }
  }, [orderDocs, productDocs])

  // No catalog and no orders — this host doesn't sell; stay invisible.
  if (!(productDocs?.length || orderDocs?.length)) return null

  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

  const openStoreAction = (
    <Button
      component={AppLink as any}
      {...({ componentVariant: 'naked', nativeButton: false } as any)}
      href={consoleRoute.base ? `${consoleRoute.base}/products` : undefined}
      size="small"
      color="primary"
    >
      {'Open store'}
    </Button>
  )

  if (!orgReady) {
    // `checkEntitlement(undefined)` resolves the FREE tier rather than
    // "unknown" (see `useOrgPlan`), and this card's "no" is an upsell —
    // never accuse a paying org of being unentitled while the plan doc is
    // still in flight.
    return (
      <CardDisplay
        header={'Commerce'}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: openStoreAction }}
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
        header={'Commerce'}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: openStoreAction }}
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
          {'Commerce analytics — revenue, orders and average order value — ' +
            'is a Pro feature. Every order is still being recorded, so the ' +
            'numbers are waiting the moment you upgrade.'}
        </Alert>
      </CardDisplay>
    )
  }

  return (
    <CardDisplay
      header={'Commerce'}
      contentGutterX
      contentGutterY
      HeaderProps={{ action: openStoreAction }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={3}>
          <Stack>
            <Typography variant="h6">{money(summary.revenueCents)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {'Revenue · 30d'}
            </Typography>
          </Stack>
          <Stack>
            <Typography variant="h6">{summary.orders30d}</Typography>
            <Typography variant="caption" color="text.secondary">
              {'Orders · 30d'}
            </Typography>
          </Stack>
          <Stack>
            <Typography variant="h6">{money(summary.aovCents)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {'Avg order'}
            </Typography>
          </Stack>
          {summary.lowStock ? (
            <Stack>
              <Typography variant="h6" color="warning.main">
                {summary.lowStock}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {'Low stock'}
              </Typography>
            </Stack>
          ) : null}
        </Stack>
        {summary.latest.length ? (
          <>
            <Divider />
            <Stack spacing={0.5}>
              {summary.latest.map((order: any) => (
                <Stack
                  key={order.$id}
                  direction="row"
                  spacing={1}
                  sx={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                    {order.orderNumber
                      ? formatOrderNumber(order.orderNumber)
                      : order.$id.slice(0, 8)}
                    {order.email ? ` · ${order.email}` : ''}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center' }}
                  >
                    <Typography variant="caption">
                      {money(
                        Number(
                          order.totals?.totalCents ?? order.amountCents ?? 0,
                        ),
                      )}
                    </Typography>
                    <Chip size="small" label={order.status ?? 'paid'} />
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
CommerceGlanceCard.displayName = 'CommerceGlanceCard'

export default CommerceGlanceCard
