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
import { Button, EmptyState, ListRow, SplitView, TextField, useLayout, useMobileTheme } from '@aglyn/mobile-ui'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useCommerceContext } from '../commerce-context'
import type { CommerceMobileContext } from '../data/context'
import { money, storeSettingsQuery } from '../data/orders'
import {
  matchProductCode,
  PRODUCT_FILTERS,
  type ProductCodeField,
  type ProductFilterId,
  type ProductRow,
  productsListQuery,
} from '../data/products'
import { scannedProductCode } from '../data/scanned-codes'
import { COMMERCE_PRODUCT_SCREEN, NEW_PRODUCT_ID } from '../screen-ids'
import { BarcodeScanner, PRODUCT_BARCODE_TYPES } from '../ui/barcode-scanner'
import { confirmAction, FilterChips, IconAction, Pill, showError } from '../ui/parts'
import { PagedList } from '../ui/paged-list'
import { ProductEditorPanel } from './product-editor'

/*
 * The catalog (AGL-3621): the console's product table as a list — status
 * chips, the name search, and a barcode or SKU read by the camera — with the
 * product editor beside it on a tablet.
 */

export interface ProductCode {
  field: ProductCodeField
  value: string
}

const STATUS_LABELS: Record<string, string> = { active: 'Active', draft: 'Draft', archived: 'Archived' }

export function productSubtitle(row: ProductRow, currency: string | undefined): string {
  const [low, high] = row.priceRange
  const price = (dollars: number) => money(Math.round(dollars * 100), currency ? { currency } : null)
  const priced = low === high ? price(low) : `${price(low)}–${price(high)}`
  const stock = row.inventory == null ? 'Not tracked' : `${row.inventory} in stock`
  const variants = row.variantCount > 1 ? `${row.variantCount} variants` : null
  return [priced, stock, variants].filter(Boolean).join(' · ')
}

function useSettled(value: string, ms = 350): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

export function ProductsList({
  commerce,
  selectedId,
  onOpen,
  onCreate,
  code,
  onCode,
}: {
  commerce: CommerceMobileContext
  selectedId: string | null
  onOpen: (productId: string) => void
  onCreate: (barcode?: string) => void
  code: ProductCode | null
  onCode: (code: ProductCode | null) => void
}) {
  const theme = useMobileTheme()
  const [filter, setFilter] = useState<ProductFilterId>('all')
  const [text, setText] = useState('')
  const [scanning, setScanning] = useState(false)
  const search = useSettled(text.trim())
  const store = useQuery(storeSettingsQuery(commerce))
  const query = useInfiniteQuery(
    productsListQuery(commerce, { filter, search, ...(code ? { code } : {}) }),
  )

  const onScanned = async (raw: string) => {
    setScanning(false)
    const value = scannedProductCode(raw)
    if (!value) return showError('That code could not be read', 'Try again, or type the product name.')
    try {
      const found = await matchProductCode(commerce, value)
      if (found?.rows.length === 1) return onOpen(found.rows[0].id)
      if (found) return onCode({ field: found.field, value: found.code })
      const create = await confirmAction({
        title: 'No product has this code',
        body: `Nothing in the catalog carries ${value}. Add a product with it?`,
        confirm: 'Add product',
      })
      if (create) onCreate(value)
    } catch (error) {
      showError('Could not look that up', (error as Error).message)
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <PagedList<ProductRow>
        testID="products-list"
        query={query}
        failed="Could not load the catalog"
        header={
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space(1), padding: theme.space(2), paddingBottom: 0 }}>
              <View style={{ flex: 1 }}>
                <TextField
                  testID="products-search"
                  label="Search products"
                  placeholder="Name"
                  value={text}
                  onChangeText={(next) => {
                    setText(next)
                    if (code) onCode(null)
                  }}
                  returnKeyType="search"
                  autoCorrect={false}
                />
              </View>
              <IconAction testID="products-scan" icon="barcode-outline" label="Scan a barcode" onPress={() => setScanning(true)} />
              <IconAction testID="products-new" icon="add-circle-outline" label="New product" onPress={() => onCreate()} />
            </View>
            <FilterChips testID="products-filter" options={PRODUCT_FILTERS} value={filter} onChange={setFilter} />
            {code ? (
              <View style={{ paddingHorizontal: theme.space(2) }}>
                <Button title={`${code.field === 'skus' ? 'SKU' : 'Barcode'} ${code.value} · Clear`} variant="text" icon="close-circle-outline" onPress={() => onCode(null)} />
              </View>
            ) : null}
          </View>
        }
        empty={
          <EmptyState
            icon="pricetags-outline"
            title={search || code || filter !== 'all' ? 'No products match' : 'No products yet'}
            body={search || code || filter !== 'all' ? 'Try another filter or search.' : 'Add your first product to start selling.'}
            action={
              search || code || filter !== 'all' ? undefined : (
                <Button title="Add a product" icon="add" onPress={() => onCreate()} />
              )
            }
          />
        }
        renderItem={(row) => (
          <ListRow
            testID={`product-${row.id}`}
            icon={row.type === 'digital' ? 'cloud-download-outline' : row.type === 'service' ? 'construct-outline' : 'cube-outline'}
            title={row.name || 'Untitled product'}
            subtitle={productSubtitle(row, store.data?.currency)}
            selected={row.id === selectedId}
            onPress={() => onOpen(row.id)}
            trailing={
              row.status !== 'active' ? (
                <Pill label={STATUS_LABELS[row.status] ?? row.status} />
              ) : row.lowStock ? (
                <Pill label="Low stock" tone="warning" />
              ) : undefined
            }
          />
        )}
      />
      <BarcodeScanner
        visible={scanning}
        title="Scan a product"
        hint="Point the camera at the product's barcode or SKU label."
        barcodeTypes={PRODUCT_BARCODE_TYPES}
        onClose={() => setScanning(false)}
        onScanned={(data) => void onScanned(data)}
      />
    </View>
  )
}

export default function ProductsScreen({ context, params }: MobileScreenProps) {
  const commerce = useCommerceContext(context)
  const { split } = useLayout()
  const [selected, setSelected] = useState<{ id: string; barcode?: string } | null>(
    params['productId'] ? { id: params['productId'] } : null,
  )
  const [code, setCode] = useState<ProductCode | null>(
    params['code'] ? { field: params['codeField'] === 'skus' ? 'skus' : 'barcodes', value: params['code'] } : null,
  )
  if (!commerce) return <EmptyState icon="globe-outline" title="Pick a site to see its products" />
  const open = (id: string, barcode?: string) => {
    if (split) setSelected({ id, ...(barcode ? { barcode } : {}) })
    else context.navigate(COMMERCE_PRODUCT_SCREEN, { productId: id, ...(barcode ? { barcode } : {}) })
  }
  return (
    <SplitView
      list={
        <ProductsList
          commerce={commerce}
          selectedId={split ? (selected?.id ?? null) : null}
          onOpen={(id) => open(id)}
          onCreate={(barcode) => open(NEW_PRODUCT_ID, barcode)}
          code={code}
          onCode={setCode}
        />
      }
      detail={
        selected ? (
          <ProductEditorPanel
            key={`${selected.id}:${selected.barcode ?? ''}`}
            context={context}
            commerce={commerce}
            productId={selected.id}
            barcode={selected.barcode}
            onSaved={(id) => setSelected({ id })}
          />
        ) : (
          <EmptyState icon="pricetags-outline" title="Pick a product to edit it here" />
        )
      }
    />
  )
}
