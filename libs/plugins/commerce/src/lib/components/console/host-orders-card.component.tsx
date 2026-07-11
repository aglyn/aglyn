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

import * as Aglyn from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import OrderDetailDialog from './order-detail-dialog.component'

export interface HostOrdersCardProps {
  hostId: string
}

/**
 * Orders console (AGL-287): filterable list over webhook-written order
 * docs with a detail dialog (timeline, fulfill, refund, cancel, notes,
 * packing slip) and draft orders that send the buyer a payment link.
 */
export function HostOrdersCard(props: HostOrdersCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: orderDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'orders'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: productDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'products'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const productNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const product of productDocs ?? []) {
      map[product.$id] = product.name ?? product.$id
    }
    return map
  }, [productDocs])

  // Sorted client-side: orderBy would drop docs missing createdAt.
  const orders = [...(orderDocs ?? [])].sort(
    (a: any, b: any) =>
      (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
  )

  // Filters + CSV export (AGL-96) over the loaded window.
  const [productFilter, setProductFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{
    productId: string
    variantId: string
    quantity: string
    email: string
    busy?: boolean
  } | null>(null)
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const visibleOrders = useMemo(() => {
    const now = Date.now() / 1000
    return orders.filter((order: any) => {
      if (productFilter && order.productId !== productFilter) return false
      const lifted = Aglyn.liftLegacyOrder(order)
      if (statusFilter && lifted.status !== statusFilter) return false
      if (channelFilter && (lifted.channel ?? 'online') !== channelFilter) {
        return false
      }
      const created = order.createdAt?.seconds ?? 0
      if (dateFilter === '7d' && now - created > 7 * 86400) return false
      if (dateFilter === '30d' && now - created > 30 * 86400) return false
      return true
    })
  }, [orders, productFilter, dateFilter, statusFilter, channelFilter])
  const handleExportCsv = useCallback(() => {
    const escape = (cell: string) =>
      /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
    const lines = [
      'date,product,amountUsd,feeUsd,customerEmail,coupon,orderId',
      ...visibleOrders.map((order: any) =>
        [
          order.createdAt?.toDate?.()
            ? order.createdAt.toDate().toISOString()
            : '',
          productNames[order.productId] ?? order.productId ?? '',
          ((order.amountCents ?? 0) / 100).toFixed(2),
          ((order.feeCents ?? 0) / 100).toFixed(2),
          order.customerEmail ?? '',
          order.couponCode ?? '',
          order.$id,
        ]
          .map((cell) => escape(String(cell)))
          .join(','),
      ),
    ]
    const url = URL.createObjectURL(
      new Blob([lines.join('\n')], { type: 'text/csv' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'orders.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [visibleOrders, productNames])

  const handleDraftCreate = useCallback(async () => {
    if (!draft?.productId) return
    setDraft((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/commerce/draft-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          productId: draft.productId,
          variantId: draft.variantId || undefined,
          quantity: Number(draft.quantity) || 1,
          email: draft.email || undefined,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Draft order failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      await navigator.clipboard.writeText(payload.url).catch(() => undefined)
      enqueueSnackbar('Draft created — payment link copied', {
        variant: 'success',
        persist: false,
      })
      setDraft(null)
    } finally {
      setDraft((prev) => (prev ? { ...prev, busy: false } : prev))
    }
  }, [draft, user, hostId, enqueueSnackbar])

  const selectedOrder =
    (orderDocs ?? []).find((order: any) => order.$id === selectedId) ?? null

  return (
    <CardDisplay header={'Orders'} contentGutterX contentGutterY>
      {orders.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No orders yet — sales from Product blocks appear here.'}
        </Typography>
      ) : (
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              select
              size="small"
              label="Product"
              value={productFilter}
              onChange={(event) => setProductFilter(event.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">{'All products'}</MenuItem>
              {(productDocs ?? []).map((product: any) => (
                <MenuItem key={product.$id} value={product.$id}>
                  {product.name ?? product.$id}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Period"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              sx={{ minWidth: 130 }}
            >
              <MenuItem value="">{'All time'}</MenuItem>
              <MenuItem value="7d">{'Last 7 days'}</MenuItem>
              <MenuItem value="30d">{'Last 30 days'}</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="Status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              sx={{ minWidth: 130 }}
            >
              <MenuItem value="">{'All statuses'}</MenuItem>
              {['pending', 'paid', 'fulfilled', 'delivered', 'cancelled', 'refunded'].map(
                (status) => (
                  <MenuItem key={status} value={status}>
                    {status}
                  </MenuItem>
                ),
              )}
            </TextField>
            <TextField
              select
              size="small"
              label="Channel"
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              sx={{ minWidth: 120 }}
            >
              <MenuItem value="">{'All channels'}</MenuItem>
              <MenuItem value="online">{'Online'}</MenuItem>
              <MenuItem value="pos">{'POS'}</MenuItem>
              <MenuItem value="draft">{'Draft'}</MenuItem>
            </TextField>
            <Button size="small" onClick={handleExportCsv}>
              {'Export CSV'}
            </Button>
            <Button
              size="small"
              variant="contained"
              color="secondary"
              onClick={() =>
                setDraft({ productId: '', variantId: '', quantity: '1', email: '' })
              }
            >
              {'Draft order'}
            </Button>
          </Stack>
          {visibleOrders.map((order: any) => {
            const lifted = Aglyn.liftLegacyOrder(order)
            return (
              <Stack
                key={order.$id}
                spacing={0}
                onClick={() => setSelectedId(order.$id)}
                sx={{ cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                    {`${Aglyn.formatOrderNumber(lifted, order.$id)} · ` +
                      (lifted.lineItems?.[0]?.name ??
                        productNames[order.productId] ??
                        order.productId ??
                        '') +
                      ` · $${(((lifted.totals?.totalCents ?? order.amountCents) ?? 0) / 100).toFixed(2)}`}
                  </Typography>
                  <Chip
                    label={lifted.status.replace('_', ' ')}
                    size="small"
                    variant="outlined"
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {(order.customerEmail ? `${order.customerEmail} · ` : '') +
                    (order.createdAt?.toDate?.()
                      ? order.createdAt.toDate().toLocaleString()
                      : '')}
                </Typography>
              </Stack>
            )
          })}
        </Stack>
      )}
      {selectedOrder ? (
        <OrderDetailDialog
          hostId={hostId}
          order={selectedOrder}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Draft order'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Product"
            value={draft?.productId ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, productId: event.target.value, variantId: '' }
                  : prev,
              )
            }
            size="small"
            select
            sx={{ mt: 1 }}
          >
            {(productDocs ?? [])
              .filter((product: any) => !product.deletedAt)
              .map((product: any) => (
                <MenuItem key={product.$id} value={product.$id}>
                  {product.name ?? product.$id}
                </MenuItem>
              ))}
          </TextField>
          {(() => {
            const product = (productDocs ?? []).find(
              (item: any) => item.$id === draft?.productId,
            )
            const variants = product
              ? Aglyn.liftLegacyProduct(product).variants
              : []
            return variants.length > 1 ? (
              <TextField
                label="Variant"
                value={draft?.variantId ?? ''}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev ? { ...prev, variantId: event.target.value } : prev,
                  )
                }
                size="small"
                select
              >
                {variants.map((variant) => (
                  <MenuItem key={variant.id} value={variant.id}>
                    {`${Object.values(variant.options ?? {}).join(' / ') || 'Default'} — $${variant.priceUsd}`}
                  </MenuItem>
                ))}
              </TextField>
            ) : null
          })()}
          <TextField
            label="Quantity"
            value={draft?.quantity ?? '1'}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      quantity: event.target.value.replace(/[^0-9]/g, ''),
                    }
                  : prev,
              )
            }
            size="small"
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          />
          <TextField
            label="Buyer email (optional)"
            value={draft?.email ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, email: event.target.value } : prev,
              )
            }
            size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!draft?.productId || draft?.busy}
            onClick={handleDraftCreate}
          >
            {'Create & copy link'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostOrdersCard.displayName = 'HostOrdersCard'

export default HostOrdersCard
