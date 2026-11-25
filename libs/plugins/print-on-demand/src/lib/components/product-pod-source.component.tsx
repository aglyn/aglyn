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

import { permissionRefusalText } from '@aglyn/aglyn/app-utils/org-permissions'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { useSiteKeys } from '@aglyn/tenant-feature-instance/hooks/use-site-keys'
import { Alert, Button, Stack, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { POD_API_ROUTES } from '../constants/api-routes'
import type { PodProductLinkView, PodShippingCost } from '../model/print-on-demand'
import { PRINT_ON_DEMAND_SITE_PRESETS } from '../model/print-on-demand-permissions'
import { LinkProductDialog } from './link-product-dialog.component'
import { formatDate, formatMoney, usePodConnections, usePodFetch } from './pod-api'

/**
 * What commerce's `productEditor` zone hands a widget, restated: the site and
 * the product as the editor holds it. Only the id and name are read.
 */
export interface ProductPodSourceProps {
  hostId: string
  product: { id: string | null; name?: string }
}

let regionNames: Intl.DisplayNames | null = null
function destination(cost: PodShippingCost): string {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    regionNames = null
  }
  const names = cost.countries.map((code) =>
    code === 'REST_OF_THE_WORLD' ? 'Everywhere else' : (regionNames?.of(code) ?? code),
  )
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more` : names.join(', ')
}

/**
 * The service behind an imported or linked product (AGL-3641): who makes
 * it, per variant what the service charges against the store's price, and
 * what it charges to ship. A product no service makes offers to link it to
 * one, for a merchant whose products came over from another store, so its
 * orders are sent there without importing a second copy.
 */
export function ProductPodSource(props: ProductPodSourceProps) {
  const { hostId, product } = props
  const request = usePodFetch()
  const pod = usePodConnections(hostId)
  const refused = useSiteKeys(hostId).blocked('printOnDemand.products', PRINT_ON_DEMAND_SITE_PRESETS['printOnDemand.products'])
  const [link, setLink] = useState<PodProductLinkView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [linking, setLinking] = useState(false)
  // Shown once the dialog closes, so its outcome stays on screen until then.
  const [justLinked, setJustLinked] = useState<PodProductLinkView | null>(null)
  const productId = product.id

  const load = useCallback(() => {
    if (!productId) return () => undefined
    let live = true
    request<{ link: PodProductLinkView | null }>(POD_API_ROUTES.productLink, { query: { hostId, productId } }).then(
      (answer) => {
        if (!live) return
        setLink(answer.link)
        setLoaded(true)
      },
      () => {
        if (!live) return
        setLink(null)
        setLoaded(true)
      },
    )
    return () => {
      live = false
    }
  }, [hostId, productId, request])

  useEffect(() => load(), [load])

  if (!productId || !loaded) return null
  if (!link) {
    if (pod.connections.length === 0) return null
    const names = pod.connections.map((connection) => connection.providerLabel).join(' or ')
    return (
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="subtitle2">{`Made by ${names}?`}</Typography>
        <Typography variant="body2" color="text.secondary">
          {`Link this product to the ${names} product that makes it, and its paid orders are sent there. Nothing is copied: it keeps its name, description, photos, prices and address.`}
        </Typography>
        <BlockedControl blocked={refused} reason={permissionRefusalText('printOnDemand.products')}>
          <Button size="small" variant="outlined" disabled={refused} onClick={() => setLinking(true)}>
            {`Link to ${names} product`}
          </Button>
        </BlockedControl>
        <LinkProductDialog
          hostId={hostId}
          productId={productId}
          productName={product.name}
          open={linking}
          connections={pod.connections}
          onClose={() => {
            setLinking(false)
            if (justLinked) setLink(justLinked)
          }}
          onLinked={setJustLinked}
        />
      </Stack>
    )
  }
  const shippingCurrency = link.shippingCosts[0]?.currency ?? link.costCurrency
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle2">{`Made and shipped by ${link.providerLabel}`}</Typography>
        <StatusChip label={`Updated ${formatDate(link.syncedAtMs)}`} variant="outlined" />
      </Stack>
      {link.sourceGone ? (
        <Alert severity="warning">
          {link.lastError ?? `${link.providerLabel} no longer has this product, so it was taken off sale.`}
        </Alert>
      ) : link.lastError ? (
        <Alert severity="info">{link.lastError}</Alert>
      ) : null}
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
      {link.shippingCosts.length ? (
        <>
          <Typography variant="subtitle2" sx={{ pt: 1 }}>{`What ${link.providerLabel} charges you to ship it`}</Typography>
          <Typography variant="body2" color="text.secondary">
            {`Standard shipping, the highest of its variants. Set your store’s shipping rates to cover it; your buyers pay your store’s rates, not ${link.providerLabel}’s.`}
          </Typography>
          <ScrollTable size="small" aria-label={`${link.providerLabel} shipping`}>
            <TableHead>
              <TableRow>
                <TableCell>To</TableCell>
                <TableCell align="right">First item</TableCell>
                <TableCell align="right">Each additional item</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {link.shippingCosts.map((cost) => (
                <TableRow key={cost.countries.join(',')}>
                  <TableCell>{destination(cost)}</TableCell>
                  <TableCell align="right">{formatMoney(cost.firstItemMinor, shippingCurrency)}</TableCell>
                  <TableCell align="right">{formatMoney(cost.additionalItemMinor, shippingCurrency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ScrollTable>
        </>
      ) : null}
    </Stack>
  )
}

export default ProductPodSource
