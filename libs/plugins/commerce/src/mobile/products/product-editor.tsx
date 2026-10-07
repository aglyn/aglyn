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

import type { MobilePluginContext, MobileScreenProps } from '@aglyn/mobile-plugin-host'
import { Button, Card, EmptyState, Screen, Skeleton, Text, TextField, useMobileTheme } from '@aglyn/mobile-ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, View } from 'react-native'
import type { HostProduct, ProductStatus, ProductType } from '../../lib/model/commerce'
import { errorText, useCommerceContext } from '../commerce-context'
import type { CommerceMobileContext } from '../data/context'
import { mediaForAddress, replaceMedia, uploadMedia } from '../data/dam-upload'
import { minorUnitsFromText, textFromMinorUnits } from '../data/money-input'
import { commerceKeys } from '../data/orders'
import {
  blankProductEdit,
  checkProductEdit,
  createProduct,
  newProductId,
  type ProductEdit,
  productEditOf,
  productQuery,
  updateProduct,
} from '../data/products'
import { NEW_PRODUCT_ID } from '../screen-ids'
import { BarcodeScanner, PRODUCT_BARCODE_TYPES } from '../ui/barcode-scanner'
import { FilterChips, IconAction, showError, useLeave } from '../ui/parts'
import { deviceDamTransport, pickPhoto, type PhotoSource, productImageUri } from './device-media'
import { StockSheet } from './stock-sheet'

/*
 * Creating and editing a product from the phone (AGL-3621): photos from the
 * camera or the library into the site's media library, the name and
 * description, status and type, and each variant's price, compare-at price,
 * SKU and barcode — scanned or typed. Stock moves through the stock sheet,
 * never by typing over a count a sale may have changed. Options, SEO and
 * digital files stay in the console, one tap away.
 */

const STATUSES: ReadonlyArray<{ id: ProductStatus; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'draft', label: 'Draft' },
  { id: 'archived', label: 'Archived' },
]
const TYPES: ReadonlyArray<{ id: ProductType; label: string }> = [
  { id: 'physical', label: 'Physical' },
  { id: 'digital', label: 'Digital' },
  { id: 'service', label: 'Service' },
]

/** Prices are stored in dollars (`priceUsd`); the fields edit them as text. */
interface PriceText {
  price: string
  compareAt: string
}

const dollarsText = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(Number(value)) ? '' : textFromMinorUnits(Math.round(Number(value) * 100), 'USD')

function dollarsOf(text: string): number | null {
  const cents = minorUnitsFromText(text, 'USD')
  return cents == null ? null : cents / 100
}

export function variantTitle(product: Pick<HostProduct, 'variants'> | null, variantId: string, index: number): string {
  const variant = product?.variants.find((entry) => entry.id === variantId)
  const label = Object.values(variant?.options ?? {}).filter(Boolean).join(' / ')
  return label || (index === 0 ? 'Default' : `Variant ${index + 1}`)
}

export function ProductEditorPanel({
  context,
  commerce,
  productId,
  barcode,
  onSaved,
}: {
  context: MobilePluginContext
  commerce: CommerceMobileContext
  productId: string
  barcode?: string
  onSaved: (productId: string) => void
}) {
  const theme = useMobileTheme()
  const client = useQueryClient()
  const creating = productId === NEW_PRODUCT_ID
  const [newId] = useState(() => (creating ? newProductId() : productId))
  const query = useQuery({ ...productQuery(commerce, productId), enabled: !creating })
  const product = creating ? null : (query.data?.product ?? null)

  const [edit, setEdit] = useState<ProductEdit | null>(null)
  const [prices, setPrices] = useState<Record<string, PriceText>>({})
  const [initialStock, setInitialStock] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [scanFor, setScanFor] = useState<string | null>(null)
  const [stockFor, setStockFor] = useState<string | null>(null)

  // Seeded once from the product as loaded; a refetch after a stock move does not overwrite typing.
  useEffect(() => {
    if (edit) return
    if (creating) {
      const blank = blankProductEdit()
      const seeded: ProductEdit = barcode
        ? { ...blank, variants: [{ ...blank.variants[0], barcode: barcode.trim() }] }
        : blank
      setEdit(seeded)
      setPrices({ default: { price: '', compareAt: '' } })
    } else if (product) {
      const loaded = productEditOf(product)
      setEdit(loaded)
      setPrices(
        Object.fromEntries(
          loaded.variants.map((variant) => [
            variant.id,
            { price: dollarsText(variant.priceUsd), compareAt: dollarsText(variant.compareAtPriceUsd) },
          ]),
        ),
      )
    }
  }, [creating, product, edit, barcode])

  const priced = useMemo<ProductEdit | null>(() => {
    if (!edit) return null
    return {
      ...edit,
      variants: edit.variants.map((variant) => {
        const text = prices[variant.id]
        const price = text ? dollarsOf(text.price) : variant.priceUsd
        const compareAt = text?.compareAt.trim() ? dollarsOf(text.compareAt) : null
        return { ...variant, priceUsd: price ?? Number.NaN, compareAtPriceUsd: compareAt }
      }),
    }
  }, [edit, prices])

  const base: HostProduct | null = creating
    ? { name: '', slug: '', type: edit?.type ?? 'physical', status: edit?.status ?? 'draft', variants: [{ id: 'default', priceUsd: 0 }] }
    : product
  const badPrice = priced?.variants.some((variant) => !Number.isFinite(variant.priceUsd) || variant.priceUsd < 0)
  const stockText = initialStock.trim()
  const stockValue = stockText ? Number(stockText) : null
  const badStock = stockValue != null && (!Number.isInteger(stockValue) || stockValue < 0)
  const problem = !priced || !base
    ? null
    : badPrice
      ? 'Enter a price for every variant'
      : badStock
        ? 'Stock is a whole number of units'
        : checkProductEdit(base, priced)

  const save = useMutation({
    mutationFn: async () => {
      if (!priced) return newId
      if (creating) {
        await createProduct(commerce, { productId: newId, edit: priced, inventory: stockValue })
      } else {
        await updateProduct(commerce, { productId, edit: priced })
      }
      return newId
    },
    onSuccess: (id) => {
      void client.invalidateQueries({ queryKey: commerceKeys.products(commerce.hostId) })
      onSaved(id)
    },
    onError: (error) => showError('The product was not saved', errorText(error)),
  })

  const transport = useMemo(() => deviceDamTransport(commerce.api), [commerce.api])

  const addPhoto = async (source: PhotoSource) => {
    try {
      const file = await pickPhoto(source)
      if (!file) return
      setPhotoBusy(true)
      const asset = await uploadMedia(transport, commerce.firestore, { hostId: commerce.hostId, file })
      setEdit((current) => (current ? { ...current, mediaUrls: [...current.mediaUrls, asset.url] } : current))
    } catch (error) {
      showError('The photo was not added', errorText(error))
    } finally {
      setPhotoBusy(false)
    }
  }

  const replacePhoto = async (address: string, source: PhotoSource) => {
    try {
      const asset = await mediaForAddress(commerce.firestore, commerce.hostId, address)
      if (!asset) {
        showError('This photo is not in your media library', 'Remove it and add a new one instead.')
        return
      }
      const file = await pickPhoto(source)
      if (!file) return
      setPhotoBusy(true)
      await replaceMedia(transport, {
        hostId: commerce.hostId,
        mediaId: asset.mediaId,
        file,
        ...(asset.updatedAtMs ? { expectedUpdatedAtMs: asset.updatedAtMs } : {}),
      })
      Alert.alert('Photo replaced', 'Everywhere this photo appears now shows the new one.')
    } catch (error) {
      showError('The photo was not replaced', errorText(error))
    } finally {
      setPhotoBusy(false)
    }
  }

  const photoMenu = (address: string, index: number) => {
    Alert.alert('Photo', undefined, [
      ...(index > 0
        ? [
            {
              text: 'Make main photo',
              onPress: () =>
                setEdit((current) =>
                  current
                    ? { ...current, mediaUrls: [address, ...current.mediaUrls.filter((url) => url !== address)] }
                    : current,
                ),
            },
          ]
        : []),
      { text: 'Replace with camera', onPress: () => void replacePhoto(address, 'camera') },
      { text: 'Replace from library', onPress: () => void replacePhoto(address, 'library') },
      {
        text: 'Remove from product',
        style: 'destructive' as const,
        onPress: () =>
          setEdit((current) => (current ? { ...current, mediaUrls: current.mediaUrls.filter((url) => url !== address) } : current)),
      },
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  if (!creating && query.isPending) {
    return (
      <Screen>
        <Skeleton height={96} />
        <Skeleton height={200} />
      </Screen>
    )
  }
  if (!creating && !product) {
    return (
      <Screen>
        <EmptyState
          icon="pricetags-outline"
          title={query.isError ? 'Could not load this product' : 'This product was deleted'}
          body={query.isError ? errorText(query.error) : undefined}
        />
      </Screen>
    )
  }
  if (!edit) return null

  const set = (patch: Partial<ProductEdit>) => setEdit({ ...edit, ...patch })
  const setVariant = (variantId: string, patch: Partial<ProductEdit['variants'][number]>) =>
    set({ variants: edit.variants.map((variant) => (variant.id === variantId ? { ...variant, ...patch } : variant)) })

  return (
    <Screen>
      <Card
        title={creating ? 'New product' : edit.name || 'Product'}
        actions={
          <Button
            testID="product-save"
            title={creating ? 'Add product' : 'Save'}
            disabled={Boolean(problem)}
            busy={save.isPending}
            onPress={() => save.mutate()}
          />
        }
      >
        {problem && edit.name.trim() ? (
          <Text variant="caption" tone="error" testID="product-problem">
            {problem}
          </Text>
        ) : null}
        <TextField testID="product-name" label="Name" value={edit.name} onChangeText={(name) => set({ name })} maxLength={120} />
        <TextField
          testID="product-description"
          label="Description"
          value={edit.description ?? ''}
          onChangeText={(description) => set({ description })}
          multiline
          numberOfLines={4}
          style={{ minHeight: 96, textAlignVertical: 'top' }}
        />
        <View style={{ marginHorizontal: -theme.space(2) }}>
          <FilterChips testID="product-status" options={STATUSES} value={edit.status} onChange={(status) => set({ status })} />
          <FilterChips testID="product-type" options={TYPES} value={edit.type} onChange={(type) => set({ type })} />
        </View>
      </Card>

      <Card
        title="Photos"
        actions={
          <View style={{ flexDirection: 'row', gap: theme.space(1) }}>
            <IconAction testID="photo-camera" icon="camera-outline" label="Take a photo" onPress={() => void addPhoto('camera')} />
            <IconAction testID="photo-library" icon="images-outline" label="Choose a photo" onPress={() => void addPhoto('library')} />
          </View>
        }
      >
        {edit.mediaUrls.length || photoBusy ? (
          <ScrollView horizontal contentContainerStyle={{ gap: theme.space(1) }}>
            {edit.mediaUrls.map((address, index) => {
              const uri = productImageUri(address)
              return (
                <Pressable
                  key={address}
                  testID={`photo-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={index === 0 ? 'Main photo' : `Photo ${index + 1}`}
                  onPress={() => photoMenu(address, index)}
                >
                  {uri ? (
                    <Image source={{ uri }} style={{ width: 88, height: 88, borderRadius: theme.radius }} />
                  ) : (
                    <View style={{ width: 88, height: 88, borderRadius: theme.radius, backgroundColor: theme.colors.divider }} />
                  )}
                </Pressable>
              )
            })}
            {photoBusy ? (
              <View style={{ width: 88, height: 88, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator />
              </View>
            ) : null}
          </ScrollView>
        ) : (
          <Text tone="secondary">Take a photo or pick one from your library. It is added to the site's media library.</Text>
        )}
      </Card>

      {edit.variants.map((variant, index) => {
        const text = prices[variant.id] ?? { price: '', compareAt: '' }
        const stored = product?.variants.find((entry) => entry.id === variant.id)
        return (
          <Card key={variant.id} title={edit.variants.length > 1 ? variantTitle(product, variant.id, index) : 'Price and codes'}>
            <View style={{ flexDirection: 'row', gap: theme.space(1) }}>
              <View style={{ flex: 1 }}>
                <TextField
                  testID={`variant-price-${index}`}
                  label="Price"
                  value={text.price}
                  keyboardType="decimal-pad"
                  onChangeText={(price) => setPrices({ ...prices, [variant.id]: { ...text, price } })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Compare-at price"
                  value={text.compareAt}
                  keyboardType="decimal-pad"
                  onChangeText={(compareAt) => setPrices({ ...prices, [variant.id]: { ...text, compareAt } })}
                />
              </View>
            </View>
            <TextField label="SKU" value={variant.sku ?? ''} autoCapitalize="characters" onChangeText={(sku) => setVariant(variant.id, { sku })} />
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space(1) }}>
              <View style={{ flex: 1 }}>
                <TextField
                  testID={`variant-barcode-${index}`}
                  label="Barcode"
                  value={variant.barcode ?? ''}
                  autoCorrect={false}
                  onChangeText={(next) => setVariant(variant.id, { barcode: next })}
                />
              </View>
              <IconAction testID={`variant-scan-${index}`} icon="barcode-outline" label="Scan the barcode" onPress={() => setScanFor(variant.id)} />
            </View>
            {creating ? (
              edit.variants.length === 1 ? (
                <TextField
                  testID="product-initial-stock"
                  label="Units in stock (leave empty to not track)"
                  value={initialStock}
                  keyboardType="number-pad"
                  onChangeText={setInitialStock}
                />
              ) : null
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(1) }}>
                <Text tone="secondary" style={{ flex: 1 }}>
                  {stored?.inventory == null ? 'Stock is not tracked' : `${stored.inventory} in stock`}
                </Text>
                {stored?.inventory != null ? (
                  <Button
                    testID={`variant-stock-${index}`}
                    title="Adjust stock"
                    variant="outlined"
                    icon="layers-outline"
                    onPress={() => setStockFor(variant.id)}
                  />
                ) : null}
              </View>
            )}
          </Card>
        )
      })}

      <Button
        title="Options, SEO and files in the console"
        variant="text"
        icon="open-outline"
        onPress={() => context.openConsolePath('/products', 'site')}
      />

      <BarcodeScanner
        visible={scanFor != null}
        title="Scan the barcode"
        hint="Point the camera at the barcode on the product or its packaging."
        barcodeTypes={PRODUCT_BARCODE_TYPES}
        onClose={() => setScanFor(null)}
        onScanned={(data) => {
          const variantId = scanFor
          setScanFor(null)
          if (variantId) setVariant(variantId, { barcode: data.trim() })
        }}
      />
      {!creating && product ? (
        <StockSheet
          visible={stockFor != null}
          commerce={commerce}
          productId={productId}
          product={product}
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

/** The editor on its own screen, as a phone opens it. */
export default function ProductScreen({ context, params }: MobileScreenProps) {
  const commerce = useCommerceContext(context)
  const leave = useLeave()
  const productId = params['productId'] ?? NEW_PRODUCT_ID
  if (!commerce) return <EmptyState icon="globe-outline" title="Pick a site first" />
  return (
    <ProductEditorPanel
      context={context}
      commerce={commerce}
      productId={productId}
      barcode={params['barcode']}
      onSaved={() => leave()}
    />
  )
}
