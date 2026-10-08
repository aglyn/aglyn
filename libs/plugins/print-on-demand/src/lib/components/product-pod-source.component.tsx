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

import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { Stack, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { POD_API_ROUTES } from '../constants/api-routes'
import type { PodProductLinkView } from '../model/print-on-demand'
import { formatDate, formatMoney, usePodFetch } from './pod-api'

/**
 * What commerce's `productEditor` zone hands a widget, restated: the site and
 * the product as the editor holds it. Only the id is read.
 */
export interface ProductPodSourceProps {
  hostId: string
  product: { id: string | null }
}

/**
 * The service behind an imported product (AGL-3641): who makes it, and per
 * variant what the service charges against the store's price. Read-only —
 * the product's own fields are edited in the editor as usual. Draws nothing
 * for a product no service makes.
 */
export function ProductPodSource(props: ProductPodSourceProps) {
  const { hostId, product } = props
  const request = usePodFetch()
  const [link, setLink] = useState<PodProductLinkView | null>(null)
  const productId = product.id

  useEffect(() => {
    if (!productId) return
    let live = true
    request<{ link: PodProductLinkView | null }>(POD_API_ROUTES.productLink, { query: { hostId, productId } }).then(
      (answer) => live && setLink(answer.link),
      () => live && setLink(null),
    )
    return () => {
      live = false
    }
  }, [hostId, productId, request])

  if (!link || !productId) return null
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle2">{`Made and shipped by ${link.providerLabel}`}</Typography>
        <StatusChip label={`Updated ${formatDate(link.syncedAtMs)}`} variant="outlined" />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {`Paid orders for this product are sent to ${link.providerLabel}. Costs are what ${link.providerLabel} charges you per item, before shipping; your store’s own prices are set above.`}
      </Typography>
      <ScrollTable size="small" aria-label={`${link.providerLabel} costs`}>
        <TableHead>
          <TableRow>
            <TableCell>Variant</TableCell>
            <TableCell align="right">{`${link.providerLabel} cost`}</TableCell>
            <TableCell align="right">{`${link.providerLabel} retail price`}</TableCell>
            <TableCell align="right">Available</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {link.variants.map((variant) => (
            <TableRow key={variant.sourceVariantId}>
              <TableCell>{variant.name}</TableCell>
              <TableCell align="right">{formatMoney(variant.costMinor, link.costCurrency)}</TableCell>
              <TableCell align="right">{formatMoney(variant.retailMinor, link.costCurrency)}</TableCell>
              <TableCell align="right">{variant.available ? 'Yes' : 'No'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </ScrollTable>
    </Stack>
  )
}

export default ProductPodSource
