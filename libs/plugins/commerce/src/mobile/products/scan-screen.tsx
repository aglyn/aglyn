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

import type { MobileScreenProps } from '@aglyn/mobile-plugin-host'
import { Button, Card, EmptyState, ListRow, Screen, Text, useMobileTheme } from '@aglyn/mobile-ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { View } from 'react-native'
import type { HostProduct } from '../../lib/model/commerce'
import { errorText, useCommerceContext } from '../commerce-context'
import { commerceKeys } from '../data/orders'
import { matchProductCode, productQuery, type ProductRow } from '../data/products'
import { COMMERCE_PRODUCT_SCREEN, NEW_PRODUCT_ID } from '../screen-ids'
import { BarcodeScanner, PRODUCT_BARCODE_TYPES } from '../ui/barcode-scanner'
import { Fact } from '../ui/parts'
import { variantTitle } from './product-editor'
import { StockSheet } from './stock-sheet'

/*
 * Scan to count (AGL-3621): read a barcode or SKU label, land on the product
 * and the variant it names, and move its stock — the stockroom loop, one
 * code after another, without typing.
 */

/** The variant a scanned code names: its barcode, else its SKU, as the product's search keys store them. */
export function variantForCode(product: Pick<HostProduct, 'variants'>, code: string): string | null {
  const key = code.trim().toLowerCase()
  const match = (value: string | undefined) => (value ?? '').trim().toLowerCase() === key
  return (
    product.variants.find((variant) => match(variant.barcode))?.id ??
    product.variants.find((variant) => match(variant.sku))?.id ??
    null
  )
}

export default function ScanScreen({ context }: MobileScreenProps) {
  const commerce = useCommerceContext(context)
  const theme = useMobileTheme()
  const client = useQueryClient()
  const [scanning, setScanning] = useState(true)
  const [code, setCode] = useState<string | null>(null)
  const [productId, setProductId] = useState<string | null>(null)
  const [stockFor, setStockFor] = useState<string | null>(null)

  const lookup = useMutation({
    mutationFn: (raw: string) => (commerce ? matchProductCode(commerce, raw) : Promise.resolve(null)),
    onSuccess: (found, raw) => {
      setCode(found?.code ?? raw.trim())
      setProductId(found?.rows.length === 1 ? found.rows[0].id : null)
    },
  })
  const product = useQuery({
    queryKey: ['commerce', commerce?.hostId ?? '', 'products', 'one', productId ?? ''] as const,
    queryFn: () => (commerce && productId ? productQuery(commerce, productId).queryFn() : Promise.resolve(null)),
    enabled: Boolean(commerce && productId),
  })

  if (!commerce) return <EmptyState icon="globe-outline" title="Pick a site to scan its products" />
  const matches: ProductRow[] = lookup.data?.rows ?? []
  const detail = product.data ?? null
  const matched = detail && code ? variantForCode(detail.product, code) : null

  return (
    <Screen>
      <Button testID="scan-again" title={code ? 'Scan another' : 'Scan a barcode'} icon="barcode-outline" onPress={() => setScanning(true)} />
      {lookup.isPending ? <Text tone="secondary">Looking it up…</Text> : null}
      {lookup.isError ? <Text tone="error">{errorText(lookup.error)}</Text> : null}
      {code && lookup.isSuccess && !matches.length ? (
        <EmptyState
          icon="help-circle-outline"
          title="No product has this code"
          body={code}
          action={
            <Button
              title="Add a product with it"
              icon="add"
              onPress={() => context.navigate(COMMERCE_PRODUCT_SCREEN, { productId: NEW_PRODUCT_ID, barcode: code })}
            />
          }
        />
      ) : null}
      {matches.length > 1 && !productId ? (
        <Card title={`${matches.length} products carry ${code}`}>
          {matches.map((row) => (
            <ListRow key={row.id} title={row.name} subtitle={row.inventory == null ? 'Not tracked' : `${row.inventory} in stock`} onPress={() => setProductId(row.id)} />
          ))}
        </Card>
      ) : null}
      {detail ? (
        <Card title={detail.product.name} actions={<Button title="Edit" variant="text" onPress={() => context.navigate(COMMERCE_PRODUCT_SCREEN, { productId: detail.id })} />}>
          {detail.product.variants.map((variant, index) => (
            <View
              key={variant.id}
              testID={`scan-variant-${variant.id}`}
              style={{
                gap: theme.space(0.5),
                padding: theme.space(1),
                borderRadius: theme.radius,
                backgroundColor: variant.id === matched ? theme.colors.background.default : 'transparent',
              }}
            >
              <Fact
                label={variantTitle(detail.product, variant.id, index) + (variant.id === matched ? ' · scanned' : '')}
                value={variant.inventory == null ? 'Not tracked' : `${variant.inventory} in stock`}
              />
              {variant.inventory != null ? (
                <Button
                  testID={`scan-adjust-${variant.id}`}
                  title="Adjust stock"
                  variant={variant.id === matched ? 'contained' : 'outlined'}
                  icon="layers-outline"
                  onPress={() => setStockFor(variant.id)}
                />
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}
      <BarcodeScanner
        visible={scanning}
        title="Scan a product"
        hint="Point the camera at the product's barcode or SKU label."
        barcodeTypes={PRODUCT_BARCODE_TYPES}
        onClose={() => setScanning(false)}
        onScanned={(data) => {
          setScanning(false)
          setProductId(null)
          lookup.mutate(data)
        }}
      />
      {detail ? (
        <StockSheet
          visible={stockFor != null}
          commerce={commerce}
          productId={detail.id}
          product={detail.product}
          variantId={stockFor}
          onClose={() => setStockFor(null)}
          onDone={() => {
            setStockFor(null)
            void client.invalidateQueries({ queryKey: commerceKeys.products(commerce.hostId) })
          }}
        />
      ) : null}
    </Screen>
  )
}
