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
import { Stack, Typography } from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
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

  return (
    <CardDisplay header={'Orders'} contentGutterX contentGutterY>
      {orders.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No orders yet — sales from Product blocks appear here.'}
        </Typography>
      ) : (
        <Stack spacing={1}>
          {orders.map((order: any) => (
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
