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

import {
  formatOrderNumber,
  isLowStock,
  liftLegacyProduct,
  orderIsTestMode,
} from '../../model'
import { checkEntitlement, pluginDocsHelp } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Alert, Button, Chip, Divider, Stack, Typography } from '@mui/material'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { useMemo } from 'react'
import {
  ceilingedWindow,
  collectionCeiling,
  useConsoleHostRoute,
  useFirestore,
  useOrgPlan,
} from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * How many orders the 30-day figures may be computed from, and how many
 * products the low-stock count may scan.
 *
 * Both tiles are aggregates, so neither can be paged: a sum over page one is
 * not a sum. What bounds them instead is the window itself — the orders query
 * asks for thirty days rather than for a count, so a store reads what it sold
 * rather than a fixed slab, and only a store selling more than this in a month
 * meets the ceiling at all.
 *
 * A ceiling that bites makes every figure under it an UNDERSTATEMENT, which is
 * why `truncated` is rendered rather than logged. Revenue quietly short is the
 * one failure a reader cannot detect from the number itself.
 */
const GLANCE_ORDER_CEILING = 250
const GLANCE_PRODUCT_CEILING = 250

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
  /*
   * Anchored once per mount so the query identity is stable. Recomputing it
   * per render would rebuild the listener on every pass, which re-reads the
   * whole window each time.
   */
  const since = useMemo(() => Date.now() - THIRTY_DAYS_MS, [])
  /**
   * The thirty days the tiles claim, asked for as thirty days.
   *
   * `createdAtMs` is the field every order writer in the plugin stamps — cart,
   * buy-now, draft, POS cash, POS card and subscription cycle — and the one
   * `reconcile-stock` already walks the collection by. `createdAt` is not
   * interchangeable: the orders collection group is indexed on `createdAtMs`
   * alone, and a range on a field a document lacks drops that document rather
   * than mis-placing it.
   *
   * The range and the order are the same field, so this needs no composite
   * index beyond the `createdAtMs` override already declared.
   */
  const { data: orderDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'orders'),
        where('createdAtMs', '>=', since),
        orderBy('createdAtMs', 'desc'),
        limit(GLANCE_ORDER_CEILING + 1),
      ),
    [firestore, hostId, since],
    { idField: '$id' },
  )
  const { data: productDocs } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'products'),
        GLANCE_PRODUCT_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const orderWindow = useMemo(
    () => ceilingedWindow<any>(orderDocs ?? undefined, GLANCE_ORDER_CEILING),
    [orderDocs],
  )
  const productWindow = useMemo(
    () =>
      ceilingedWindow<any>(productDocs ?? undefined, GLANCE_PRODUCT_CEILING),
    [productDocs],
  )

  const summary = useMemo(() => {
    // The query returns the window already ordered newest-first; re-sorting a
    // ceilinged read would only restate the order it arrived in.
    const orders = orderWindow.rows
    // ONE DEFINITION OF 30-DAY REVENUE, NOT TWO.
    //
    // This card and `commerce-analytics-card` read the same orders collection
    // over the same window and disagreed three ways, so one dashboard showed a
    // store two different revenues:
    //
    //   - `pending` orders, which have taken no money, were counted here as
    //     revenue and excluded there.
    //   - `cancelled` was tested with the American spelling, which never
    //     matches the persisted `OrderStatus`, so every cancelled order was
    //     booked. The value is a PERSISTED enum and is not the place to apply
    //     the American-spelling rule; the comparison follows the data.
    //   - A refund was all-or-nothing: a fully-refunded order was dropped
    //     whole while a 99%-refunded one counted in full.
    //
    // The filter and the per-order figure now match that card line for line,
    // so the two cannot drift again without someone editing both.
    const recentWindow = orders.filter(
      (order) =>
        order.status !== 'pending' &&
        order.status !== 'cancelled' &&
        // A rehearsal is not revenue — the same exclusion the
        // analytics card applies, from the same helper.
        !orderIsTestMode(order),
    )
    // Net of what went back, rather than dropping the order. The legacy flat
    // `amountCents` is the fallback, matching every other money reader
    // (AGL-1747): this card had the modern read but not the fallback, so a
    // Commerce Starter order (AGL-90) rendered as $0.00.
    const orderNetCents = (order: any) =>
      Number(order.totals?.totalCents ?? order.amountCents ?? 0) -
      Number(order.refundedCents ?? 0)
    const revenueCents = recentWindow.reduce(
      (sum, order) => sum + orderNetCents(order),
      0,
    )
    const lowStock = productWindow.rows.filter((product: any) => {
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
  }, [orderWindow, productWindow])

  // No catalog and nothing sold in the window — this host doesn't sell; stay
  // invisible.
  if (!(productWindow.rows.length || orderWindow.rows.length)) return null

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
        help={pluginDocsHelp('commerce')}
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
        help={pluginDocsHelp('commerce')}
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
      help={pluginDocsHelp('commerce')}
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
        {orderWindow.truncated || productWindow.truncated ? (
          <Typography variant="caption" color="text.secondary">
            {orderWindow.truncated
              ? `Counted from the ${GLANCE_ORDER_CEILING} most recent orders of the last 30 days. Open the store for the full figures.`
              : `Low stock counted across ${GLANCE_PRODUCT_CEILING} products. Open the store for the full catalog.`}
          </Typography>
        ) : null}
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
