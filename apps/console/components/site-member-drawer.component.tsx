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
  limit,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useHostActivityLogger from '../hooks/use-host-activity-logger'
import { computeLifetimePurchaseCents } from '../utils/site-member-purchases'

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

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
 * client-side — `orderBy` would need a composite index and drop docs
 * missing `createdAt`. `orders` reads are admin/editor-only in rules
 * (AGL-502), so viewers get a note instead of history.
 */
export function SiteMemberDrawer(props: SiteMemberDrawerProps) {
  const { hostId, member, onClose } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
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
            limit(100),
          )
        : null,
    [firestore, hostId, email],
    { idField: '$id' },
  )
  const orders = useMemo(
    () =>
      [...(orderDocs ?? [])].sort(
        (a, b) => orderCreatedMs(b) - orderCreatedMs(a),
      ),
    [orderDocs],
  )
  const lifetimeCents = useMemo(
    () => computeLifetimePurchaseCents(orders),
    [orders],
  )

  const { data: subscriptionDocs } = useFirestoreCollection<any>(
    () =>
      email
        ? query(
            collection(firestore, 'hosts', hostId, 'subscriptions'),
            where('customerEmail', '==', email),
            limit(25),
          )
        : null,
    [firestore, hostId, email],
    { idField: '$id' },
  )
  // Product names for subscriptions, loaded only when any exist.
  const { data: productDocs } = useFirestoreCollection<any>(
    () =>
      email && (subscriptionDocs?.length ?? 0) > 0
        ? query(collection(firestore, 'hosts', hostId, 'products'), limit(100))
        : null,
    [firestore, hostId, email, (subscriptionDocs?.length ?? 0) > 0],
    { idField: '$id' },
  )
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
              color={suspended ? 'secondary' : 'error'}
              disabled={busy}
              onClick={handleToggleSuspended}
            >
              {suspended ? 'Reactivate member' : 'Suspend member'}
            </Button>
          </Stack>

          <Divider textAlign="left">{'Lifetime purchases'}</Divider>
          <Typography variant="h6">
            {ordersStatus === 'error' ? '—' : usd(lifetimeCents)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {'Charged order totals minus refunds; pending and cancelled ' +
              'orders excluded.'}
          </Typography>

          <Divider textAlign="left">{'Orders'}</Divider>
          {ordersStatus === 'error' ? (
            <Typography variant="body2" color="text.secondary">
              {'Order history needs the editor or admin role on this site.'}
            </Typography>
          ) : orders.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No orders yet.'}
            </Typography>
          ) : (
            orders.map((order: any) => (
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
                  {order.refundedCents
                    ? ` · refunded ${usd(Number(order.refundedCents) || 0)}`
                    : ''}
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

          {(subscriptionDocs?.length ?? 0) > 0 ? (
            <>
              <Divider textAlign="left">{'Subscriptions'}</Divider>
              {(subscriptionDocs ?? []).map((subscription: any) => (
                <Stack
                  key={subscription.$id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Stack sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {productNames[subscription.productId] ??
                        subscription.productId ??
                        'Subscription'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {subscription.currentPeriodEndMs
                        ? `Renews ${new Date(
                            Number(subscription.currentPeriodEndMs),
                          ).toLocaleDateString()}`
                        : '—'}
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
