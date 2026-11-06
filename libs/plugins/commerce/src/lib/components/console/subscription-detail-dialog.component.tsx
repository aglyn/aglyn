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
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link,
  Stack,
  Typography,
} from '@mui/material'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'

/** How many of a subscription's invoices the dialog lists: two years of monthly cycles. */
export const SUBSCRIPTION_INVOICE_WINDOW = 24

/** A stored subscription, as far as this list reads one. */
export interface SubscriptionRow {
  $id: string
  productId?: string
  customerEmail?: string | null
  customerName?: string | null
  status?: string
  interval?: string
  cancelAtPeriodEnd?: boolean
  currentPeriodEndMs?: number | null
  paidThroughMs?: number
  createdAtMs?: number
  paidCents?: number
  invoicesCount?: number
  livemode?: boolean
  lineItems?: Array<{ name?: string; quantity?: number }>
  totals?: { totalCents?: number; taxCents?: number }
}

export interface SubscriptionDetailDialogProps {
  hostId: string
  subscription: SubscriptionRow
  currency: string
  onClose: () => void
}

interface InvoiceRow {
  $id: string
  number?: string
  paidCents?: number
  currency?: string
  paidAtMs?: number
  periodStartMs?: number
  periodEndMs?: number
  billingReason?: string
  hostedInvoiceUrl?: string
}

function Fact(props: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>
        {props.label}
      </Typography>
      <Typography variant="body2">{props.value}</Typography>
    </Box>
  )
}

/**
 * One subscription and its invoices (AGL-4191). Every paid cycle is recorded
 * under `subscriptions/{id}/invoices` by the billing webhook, and this is the
 * first place a merchant can read them without opening Stripe.
 */
export function SubscriptionDetailDialog(props: SubscriptionDetailDialogProps) {
  const { hostId, subscription, currency, onClose } = props
  const firestore = useFirestore()
  const { data: invoiceDocs, status } = useFirestoreCollection<InvoiceRow>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'subscriptions', subscription.$id, 'invoices'),
        orderBy('paidAtMs', 'desc'),
        limit(SUBSCRIPTION_INVOICE_WINDOW),
      ),
    [firestore, hostId, subscription.$id],
    { idField: '$id' },
  )
  const invoices = invoiceDocs ?? []
  const money = (cents: number, code = currency) => CommerceModel.formatOrderMoney(cents, code)
  const date = CommerceModel.formatSubscriptionDate
  const dateText = CommerceModel.subscriptionDateText(
    CommerceModel.subscriptionDateLine(subscription),
  )
  const price =
    subscription.totals?.totalCents != null
      ? `${money(Number(subscription.totals.totalCents) || 0)}${CommerceModel.subscriptionIntervalSuffix(subscription.interval)}`
      : ''

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>{CommerceModel.subscriptionPlanName(subscription)}</Box>
          <Chip
            label={CommerceModel.subscriptionStatusLabel(subscription.status)}
            size="small"
            color={CommerceModel.subscriptionStatusColor(subscription.status)}
            variant="outlined"
          />
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Fact
          label="Customer"
          value={
            [subscription.customerName, subscription.customerEmail].filter(Boolean).join(' · ') ||
            'Unknown customer'
          }
        />
        {price ? <Fact label="Price" value={price} /> : null}
        {subscription.createdAtMs ? (
          <Fact label="Started" value={date(subscription.createdAtMs)} />
        ) : null}
        {dateText ? <Fact label="Next" value={dateText} /> : null}
        <Fact
          label="Paid so far"
          value={
            Number(subscription.paidCents ?? 0) > 0
              ? `${money(Number(subscription.paidCents) || 0)} over ${Number(subscription.invoicesCount ?? 0)} ${
                  Number(subscription.invoicesCount ?? 0) === 1 ? 'invoice' : 'invoices'
                }`
              : 'Nothing yet'
          }
        />
        {subscription.livemode === false ? (
          <Typography variant="caption" color="text.secondary">
            {'A test-mode subscription: no real money moved, and it is not counted in your recurring revenue.'}
          </Typography>
        ) : null}
        <Divider textAlign="left" sx={{ mt: 1 }}>
          {'Invoices'}
        </Divider>
        {invoices.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {status === 'loading' ? 'Loading invoices…' : 'No invoices recorded yet.'}
          </Typography>
        ) : (
          invoices.map((invoice) => (
            <Box key={invoice.$id} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2">
                  {invoice.paidAtMs ? date(invoice.paidAtMs) : 'Date unknown'}
                  {invoice.number ? ` · ${invoice.number}` : ''}
                </Typography>
                {invoice.periodStartMs && invoice.periodEndMs ? (
                  <Typography variant="caption" color="text.secondary">
                    {`For ${date(invoice.periodStartMs)} to ${date(invoice.periodEndMs)}`}
                  </Typography>
                ) : null}
              </Box>
              <Typography variant="body2">
                {money(Number(invoice.paidCents) || 0, invoice.currency || currency)}
              </Typography>
              {invoice.hostedInvoiceUrl ? (
                <Link href={invoice.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer" variant="body2">
                  {'View'}
                </Link>
              ) : null}
            </Box>
          ))
        )}
        {invoices.length >= SUBSCRIPTION_INVOICE_WINDOW ? (
          <Typography variant="caption" color="text.secondary">
            {`The ${SUBSCRIPTION_INVOICE_WINDOW} most recent invoices.`}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Close'}</Button>
      </DialogActions>
    </Dialog>
  )
}
SubscriptionDetailDialog.displayName = 'SubscriptionDetailDialog'

export default SubscriptionDetailDialog
