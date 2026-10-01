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

import type { ConsoleSiteMemberZoneProps } from '@aglyn/aglyn'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import {
  ceilingedWindow,
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { Chip, Divider, Stack, Typography } from '@mui/material'
import {
  collection,
  documentId,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { splitOrderReversal } from '../../model/commerce-dispute'
import { computeLifetimePurchaseCents } from '../../model/site-member-purchases'

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

/**
 * How many order documents this reads for one member.
 *
 * A CEILING, not a page size: the lifetime-purchase figure above the list is
 * summed from these rows, so every one it intends to count has to be held. A
 * server page would make that headline number the total of ten orders and
 * print it as a lifetime.
 */
const ORDER_CEILING = 100
/** The same, for the subscriptions this member holds. */
const SUBSCRIPTION_CEILING = 25

/**
 * The reversal suffix on one order row, split by the door the money left
 * through (AGL-1810). `refundedCents` carries a lost chargeback as well as a
 * refund (AGL-1787 puts both there deliberately), so rendering the whole
 * figure as "refunded" told the merchant they chose a reversal a bank took.
 * `computeLifetimePurchaseCents` keeps netting the total; only the label
 * splits.
 */
const reversalSuffix = (order: any) => {
  const { refundedCents, chargedBackCents } = splitOrderReversal(order)
  return (
    (refundedCents ? ` · refunded ${usd(refundedCents)}` : '') +
    (chargedBackCents ? ` · charged back ${usd(chargedBackCents)}` : '')
  )
}

/** Display order number: v1 sequential `#1042`, else a doc-id stub. */
const orderNumber = (order: any) =>
  order.number != null
    ? `#${order.number}`
    : `#${String(order.$id ?? '').slice(-6).toUpperCase()}`

const orderCreatedMs = (order: any) =>
  Number(order.createdAtMs ?? (order.createdAt?.seconds ?? 0) * 1000) || 0

/**
 * What a site user bought (AGL-546): the lifetime purchase total, the order
 * history (the payment records — Stripe intent id and refunds included) and
 * storefront subscriptions — the `siteMember` zone of the account's drawer.
 *
 * Orders match by email (mirrors membership-account, AGL-294) and sort
 * client-side. The QUERY orders on the document name: `orderBy('createdAt')`
 * would want a composite index and, worse, would drop every order missing the
 * field, while an equality filter plus `orderBy(documentId())` rides the
 * automatic single-field index and can drop nothing — a document's name
 * cannot be absent. That makes the window total rather than a pseudo-random
 * hundred, which is what the newest-first sort below was quietly disguising.
 * `orders` reads are admin/editor-only in rules (AGL-502), so viewers get a
 * note instead of history.
 *
 * One section per element, as a fragment: the zone is `bare`, and the drawer's
 * own column spaces what it holds.
 */
export function SiteMemberPurchases(props: ConsoleSiteMemberZoneProps) {
  const { hostId, member } = props
  const firestore = useFirestore()
  const memberId = String(member.$id ?? '')
  const email = String(member['email'] ?? '')

  const { data: orderDocs, status: ordersStatus } = useFirestoreCollection<any>(
    () =>
      email
        ? query(
            collection(firestore, 'hosts', hostId, 'orders'),
            where('customerEmail', '==', email),
            orderBy(documentId()),
            // One document past the ceiling, so "this member has more" is a
            // fact. `length === 100` cannot tell a member with exactly a
            // hundred orders from one with a thousand, and the difference is
            // whether the lifetime figure above is a total or a floor.
            limit(ORDER_CEILING + 1),
          )
        : null,
    [firestore, hostId, email],
    { idField: '$id' },
  )
  const { rows: readOrders, truncated: ordersTruncated } = ceilingedWindow<any>(
    orderDocs,
    ORDER_CEILING,
  )
  const orders = useMemo(
    () =>
      [...readOrders].sort((a, b) => orderCreatedMs(b) - orderCreatedMs(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderDocs],
  )
  const lifetimeCents = useMemo(
    () => computeLifetimePurchaseCents(orders),
    [orders],
  )
  /**
   * The order query failed AND nothing came back with it (AGL-1066).
   *
   * The copy this gates blames the reader's ROLE, which is the right
   * explanation for the denial this was written for — orders are
   * admin/editor-only in rules. It is the wrong explanation once a stale
   * SESSION can push a listen to `'error'` too, and flatly wrong when
   * `persistentLocalCache` is still serving the rows: telling someone their
   * role is insufficient while their orders sit right there is a support
   * ticket about permissions that was never about permissions.
   */
  const ordersUnreadable = ordersStatus === 'error' && orders.length === 0

  const { data: subscriptionDocs } = useFirestoreCollection<any>(
    () =>
      email
        ? query(
            collection(firestore, 'hosts', hostId, 'subscriptions'),
            where('customerEmail', '==', email),
            // The same decision as the orders above, for the same reason: a
            // subscription written without `createdAt` would be hidden by a
            // field ordering rather than mis-sorted by it.
            orderBy(documentId()),
            limit(SUBSCRIPTION_CEILING + 1),
          )
        : null,
    [firestore, hostId, email],
    { idField: '$id' },
  )
  const { rows: subscriptions, truncated: subscriptionsTruncated } =
    ceilingedWindow<any>(subscriptionDocs, SUBSCRIPTION_CEILING)
  // Product names for subscriptions, loaded only when any exist.
  const { data: productDocs } = useFirestoreCollection<any>(
    () =>
      email && (subscriptionDocs?.length ?? 0) > 0
        ? query(
            collection(firestore, 'hosts', hostId, 'products'),
            // A LOOKUP, not a list — but the same ordering decision, so the
            // hundred it reads is a reachable hundred rather than a sample,
            // and a product past it degrades a subscription's label to its
            // id rather than hiding the subscription.
            orderBy(documentId()),
            limit(100),
          )
        : null,
    [firestore, hostId, email, (subscriptionDocs?.length ?? 0) > 0],
    { idField: '$id' },
  )
  /*==========================================
   * BOTH LISTS PAGE IN MEMORY.
   *
   * Each ceiling is held whole, which is what lets the orders sort
   * newest-first and the lifetime figure sum over all of them. A server page
   * would have made both about ten rows instead of about this member.
   *=========================================*/
  const [orderPage, setOrderPage] = useState(0)
  const [orderPageSize, setOrderPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const visibleOrders = useMemo(
    () =>
      orders.slice(
        orderPage * orderPageSize,
        orderPage * orderPageSize + orderPageSize,
      ),
    [orders, orderPage, orderPageSize],
  )
  const [subscriptionPage, setSubscriptionPage] = useState(0)
  const [subscriptionPageSize, setSubscriptionPageSize] = useState(
    TABLE_PAGE_SIZE_DEFAULT,
  )
  const visibleSubscriptions = useMemo(
    () =>
      subscriptions.slice(
        subscriptionPage * subscriptionPageSize,
        subscriptionPage * subscriptionPageSize + subscriptionPageSize,
      ),
    [subscriptions, subscriptionPage, subscriptionPageSize],
  )
  /*
   * A different member starts at page one. The drawer is reused for whoever
   * is selected, so without this the next member opens three pages into a
   * history they may not have — which renders as an empty list and reads as
   * "this person never bought anything".
   */
  useEffect(() => {
    setOrderPage(0)
    setSubscriptionPage(0)
  }, [memberId])

  const productNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const product of productDocs ?? []) {
      map[product.$id] = product.name ?? product.$id
    }
    return map
  }, [productDocs])

  return (
    <>
      <Divider textAlign="left">{'Lifetime purchases'}</Divider>
      <Typography variant="h6">
        {/*
          "at least", or nothing at all. This figure is summed over the order
          WINDOW, so once the probe finds an order past the ceiling it is a
          lower bound — and a lower bound printed as a lifetime is the number
          a support agent quotes back to the customer.
        */}
        {ordersUnreadable
          ? '—'
          : `${ordersTruncated ? 'at least ' : ''}${usd(lifetimeCents)}`}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {'Charged order totals minus refunds; pending and canceled ' +
          'orders excluded.'}
        {ordersTruncated
          ? ` Summed over the ${ORDER_CEILING} orders read here; this ` +
            'member has more.'
          : ''}
      </Typography>

      <Divider textAlign="left">{'Orders'}</Divider>
      {ordersUnreadable ? (
        <Typography variant="body2" color="text.secondary">
          {'Order history needs the editor or admin role on this site.'}
        </Typography>
      ) : orders.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No orders yet.'}
        </Typography>
      ) : (
        visibleOrders.map((order: any) => (
          <Stack key={order.$id} spacing={0}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                {`${orderNumber(order)} · ${usd(
                  Number(order.totals?.totalCents ?? order.amountCents ?? 0) ||
                    0,
                )}`}
              </Typography>
              <Chip
                label={String(order.status ?? 'paid').replace('_', ' ')}
                size="small"
                variant="outlined"
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {orderCreatedMs(order)
                ? new Date(orderCreatedMs(order)).toLocaleDateString()
                : '—'}
              {reversalSuffix(order)}
            </Typography>
            {order.paymentIntentId ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontFamily: 'monospace' }}
                noWrap
              >
                {order.paymentIntentId}
              </Typography>
            ) : null}
          </Stack>
        ))
      )}
      {ordersUnreadable || orders.length === 0 ? null : (
        <ListPagination
          page={orderPage}
          pageSize={orderPageSize}
          rowCount={visibleOrders.length}
          // The orders held here — a slice of rows already read, so the
          // total is exact for the window. The lifetime caption above is
          // where the window's own shortfall is stated.
          count={orders.length}
          onPageChange={setOrderPage}
          onPageSizeChange={setOrderPageSize}
        />
      )}

      {subscriptions.length > 0 ? (
        <>
          <Divider textAlign="left">{'Subscriptions'}</Divider>
          {visibleSubscriptions.map((subscription: any) => (
            <Stack
              key={subscription.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {/*
                   * The amount (AGL-1732). This row named the product and the
                   * renewal date and stopped, and no other console surface
                   * carried the figure either — orders, analytics and the CSV
                   * all read `orders`, which a subscription sale does not
                   * create. Subscriptions written before that fix have no
                   * `totals`, so the amount is omitted rather than shown as
                   * $0.00.
                   */}
                  {productNames[subscription.productId] ??
                    subscription.productId ??
                    'Subscription'}
                  {subscription.totals?.totalCents != null
                    ? ` · ${usd(Number(subscription.totals.totalCents) || 0)}${
                        subscription.interval ? `/${subscription.interval}` : ''
                      }`
                    : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {subscription.currentPeriodEndMs
                    ? `Renews ${new Date(
                        Number(subscription.currentPeriodEndMs),
                      ).toLocaleDateString()}`
                    : '—'}
                  {/*
                   * What this subscriber has actually paid, across every cycle
                   * (AGL-1743). Omitted, not shown as 0, for subscriptions
                   * whose cycles all predate `invoice.payment_succeeded`
                   * being handled: those invoices are recoverable only from
                   * Stripe.
                   */}
                  {Number(subscription.invoicesCount ?? 0) > 0
                    ? ` · ${usd(Number(subscription.paidCents) || 0)} paid over ${
                        Number(subscription.invoicesCount) === 1
                          ? '1 invoice'
                          : `${Number(subscription.invoicesCount)} invoices`
                      }`
                    : ''}
                </Typography>
              </Stack>
              <Chip
                label={String(subscription.status ?? 'active')}
                size="small"
                variant="outlined"
                color={subscription.status === 'active' ? 'success' : 'default'}
              />
            </Stack>
          ))}
          <ListPagination
            page={subscriptionPage}
            pageSize={subscriptionPageSize}
            rowCount={visibleSubscriptions.length}
            // This member's subscriptions, in full for the window.
            count={subscriptions.length}
            onPageChange={setSubscriptionPage}
            onPageSizeChange={setSubscriptionPageSize}
          />
          {subscriptionsTruncated ? (
            <Typography variant="caption" color="text.secondary">
              {`Showing ${SUBSCRIPTION_CEILING} subscriptions; this ` +
                'member has more.'}
            </Typography>
          ) : null}
        </>
      ) : null}
    </>
  )
}
SiteMemberPurchases.displayName = 'SiteMemberPurchases'

export default SiteMemberPurchases
