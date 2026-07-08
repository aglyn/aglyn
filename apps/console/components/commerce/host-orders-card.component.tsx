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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore, useFirestoreCollectionData } from 'reactfire'

export interface HostOrdersCardProps {
  hostId: string
}

/**
 * Commerce Starter orders (AGL-90): read-only list of Stripe-webhook-written
 * order records under the host, newest first. Products resolve by id from
 * the same host subcollection. Email notifications land with email infra.
 */
export function HostOrdersCard(props: HostOrdersCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: orderDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'orders'), limit(200)),
    { idField: '$id' },
  )
  const { data: productDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'products'), limit(100)),
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
  const visibleOrders = useMemo(() => {
    const now = Date.now() / 1000
    return orders.filter((order: any) => {
      if (productFilter && order.productId !== productFilter) return false
      const created = order.createdAt?.seconds ?? 0
      if (dateFilter === '7d' && now - created > 7 * 86400) return false
      if (dateFilter === '30d' && now - created > 30 * 86400) return false
      return true
    })
  }, [orders, productFilter, dateFilter])
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
            <Button size="small" onClick={handleExportCsv}>
              {'Export CSV'}
            </Button>
          </Stack>
          {visibleOrders.map((order: any) => (
            <Stack key={order.$id} spacing={0}>
              <Typography variant="body2">
                {`${productNames[order.productId] ?? order.productId} · ` +
                  `$${((order.amountCents ?? 0) / 100).toFixed(2)}`}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {(order.customerEmail ? `${order.customerEmail} · ` : '') +
                  (order.createdAt?.toDate?.()
                    ? order.createdAt.toDate().toLocaleString()
                    : '')}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </CardDisplay>
  )
}
HostOrdersCard.displayName = 'HostOrdersCard'

export default HostOrdersCard
