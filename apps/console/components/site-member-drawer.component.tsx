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

import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Divider,
  Drawer,
  Stack,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  documentId,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ceilingedWindow, useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { TABLE_PAGE_SIZE_DEFAULT } from '../constants/shared'
import useBranding from '../hooks/use-branding'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useHostActivityLogger from '../hooks/use-host-activity-logger'
import PasswordAdminControls from './password-admin-controls.component'
import {
  computeLifetimePurchaseCents,
  splitReversalCents,
} from '../utils/site-member-purchases'

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

/**
 * How many order documents this drawer reads for one member.
 *
 * A CEILING, not a page size: the lifetime-purchase figure above the list is
 * summed from these rows, so the drawer has to hold every one it intends to
 * count. A server page would make that headline number the total of ten
 * orders and print it as a lifetime.
 */
const ORDER_CEILING = 100
/** The same, for the subscriptions this member holds. */
const SUBSCRIPTION_CEILING = 25

/**
 * The reversal suffix on one order row, split by the door the money left
 * through (AGL-1810). `refundedCents` carries a lost chargeback as well as a
 * refund (AGL-1787 puts both there deliberately), so rendering the whole
 * figure as "refunded" told the merchant they chose a reversal a bank took —
 * the defect AGL-1796 fixed on the two commerce surfaces, on the third one it
 * did not name. `computeLifetimePurchaseCents` keeps netting the total; only
 * the label splits.
 */
const reversalSuffix = (order: any) => {
  const { refundedCents, chargedBackCents } = splitReversalCents(order)
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

export interface SiteMemberDrawerProps {
  hostId: string
  /** The live siteMember doc (with `$id`); null keeps the drawer closed. */
  member: any | null
  onClose: () => void
}

/**
 * Site member detail drawer (AGL-546): profile, order history (the
 * payment records — Stripe intent id and refunds included), storefront
 * subscriptions, and the lifetime purchase total computed from the order
 * docs — plus suspend/reactivate, written via the client SDK (the rules'
 * host catch-all lets admins/editors update `siteMembers`; the tenant
 * membership APIs enforce the flag at sign-in and account load).
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
 */
export function SiteMemberDrawer(props: SiteMemberDrawerProps) {
  const { hostId, member, onClose } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  // Org-scoped copy names the org's RESOLVED product name (AGL-2319).
  const { branding } = useBranding()
  const logActivity = useHostActivityLogger(hostId)
  const [busy, setBusy] = useState(false)

  const memberId = member ? String(member.$id ?? '') : ''
  const email = member ? String(member.email ?? '') : ''
  const suspended = member?.suspended === true

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
   * The drawer holds each ceiling whole, which is what lets it sort the
   * orders newest-first and sum the lifetime figure over all of them. A
   * server page would have made both about ten rows instead of about this
   * member.
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

  const handleToggleSuspended = useCallback(async () => {
    if (!memberId || busy) return
    const next = !suspended
    const confirmed = await confirm(
      next
        ? {
            title: 'Suspend this member?',
            description:
              `"${email}" can no longer sign in on the published site; ` +
              'their account page signs out on next load. Orders and ' +
              'history are kept.',
            confirmationText: 'Suspend',
            confirmationButtonProps: { color: 'error' },
          }
        : {
            title: 'Reactivate this member?',
            description: `"${email}" can sign in again with their existing password.`,
            confirmationText: 'Reactivate',
          },
    )
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    setBusy(true)
    try {
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'siteMembers', memberId),
        { suspended: next },
      )
      enqueueSnackbar(next ? 'Member suspended' : 'Member reactivated', {
        variant: 'success',
        persist: false,
      })
      logActivity(next ? 'Suspended site member' : 'Reactivated site member', {
        type: 'member',
        name: email,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Could not update the member — check your role', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }, [
    memberId,
    busy,
    suspended,
    confirm,
    email,
    firestore,
    hostId,
    enqueueSnackbar,
    logActivity,
  ])

  // Password help (AGL-914). Unlike suspend/reactivate above, this cannot go
  // through the client SDK — the scrypt hashing and the session cut-off both
  // have to happen server-side.
  const passwordRequest = useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await authorizedFetch(
        user,
        '/api/membership/admin-password',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, memberId, ...payload }),
        },
      )
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.error ?? 'Request failed')
      return result
    },
    [user, hostId, memberId],
  )

  return (
    <Drawer anchor="right" open={Boolean(member)} onClose={onClose}>
      {member ? (
        <Stack spacing={2} sx={{ width: 400, p: 3 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="h6" noWrap sx={{ flex: 1 }}>
              {member.displayName || member.name || email || memberId}
            </Typography>
            {suspended ? (
              <Chip label="Suspended" size="small" color="error" />
            ) : null}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {email || '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {member.createdAt?.toDate?.()
              ? `Joined ${member.createdAt.toDate().toLocaleDateString()}`
              : 'Join date unknown'}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              color={suspended ? 'primary' : 'error'}
              disabled={busy}
              onClick={handleToggleSuspended}
            >
              {suspended ? 'Reactivate member' : 'Suspend member'}
            </Button>
          </Stack>

          <Divider textAlign="left">{'Password'}</Divider>
          <PasswordAdminControls
            email={email || null}
            subjectLabel={email || memberId}
            description={
              'For a member locked out of their account on this site. This ' +
              'is their site sign-in only — it has nothing to do with any ' +
              `${branding.productName} console account they may also have.`
            }
            onSendReset={async () => {
              await passwordRequest({ action: 'sendPasswordReset' })
              logActivity('Sent a site member a password reset', {
                type: 'member',
                name: email,
              })
            }}
            onSetPassword={async (password) => {
              await passwordRequest({ action: 'setPassword', password })
              logActivity('Set a site member’s password', {
                type: 'member',
                name: email,
              })
            }}
          />

          <Divider textAlign="left">{'Lifetime purchases'}</Divider>
          <Typography variant="h6">
            {/*
              "at least", or nothing at all. This figure is summed over the
              order WINDOW, so once the probe finds an order past the ceiling
              it is a lower bound — and a lower bound printed as a lifetime is
              the number a support agent quotes back to the customer.
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
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                    {`${orderNumber(order)} · ${usd(
                      Number(
                        order.totals?.totalCents ?? order.amountCents ?? 0,
                      ) || 0,
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
              // The orders this drawer HOLDS — a slice of rows already read,
              // so the total is exact for the window. The lifetime caption
              // above is where the window's own shortfall is stated.
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
                       * The amount (AGL-1732). This row named the product and
                       * the renewal date and stopped, and no other console
                       * surface carried the figure either — orders, analytics
                       * and the CSV all read `orders`, which a subscription
                       * sale does not create. "What is this subscriber paying
                       * me?" was answerable only in Stripe. Subscriptions
                       * written before that fix have no `totals`, so the
                       * amount is omitted rather than shown as $0.00.
                       */}
                      {productNames[subscription.productId] ??
                        subscription.productId ??
                        'Subscription'}
                      {subscription.totals?.totalCents != null
                        ? ` · ${usd(Number(subscription.totals.totalCents) || 0)}${
                            subscription.interval
                              ? `/${subscription.interval}`
                              : ''
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
                       * What this subscriber has actually paid, across every
                       * cycle (AGL-1743). Renewals used to be invisible to
                       * Aglyn entirely — `invoice.payment_succeeded` was
                       * unhandled — so a subscriber in month 12 read exactly
                       * like one in month 1. Omitted, not shown as 0, for
                       * subscriptions whose cycles all predate the fix: those
                       * invoices are recoverable only from Stripe.
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
                    color={
                      subscription.status === 'active' ? 'success' : 'default'
                    }
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

          {(member.addresses?.length ?? 0) > 0 ? (
            <>
              <Divider textAlign="left">{'Addresses'}</Divider>
              {(member.addresses ?? []).map((address: any, index: number) => (
                <Typography key={index} variant="body2" color="text.secondary">
                  {[
                    address.name,
                    address.line1,
                    address.line2,
                    `${address.city ?? ''} ${address.state ?? ''} ${
                      address.postalCode ?? ''
                    }`.trim(),
                    address.country,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </Typography>
              ))}
            </>
          ) : null}
        </Stack>
      ) : null}
    </Drawer>
  )
}
SiteMemberDrawer.displayName = 'SiteMemberDrawer'

export default SiteMemberDrawer
