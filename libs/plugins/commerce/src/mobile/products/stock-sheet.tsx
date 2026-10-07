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

import { Button, Sheet, Text, TextField, useMobileTheme } from '@aglyn/mobile-ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { collection, getDocs, limit, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { HostProduct, InventoryAdjustmentReason } from '../../lib/model/commerce'
import { errorText } from '../commerce-context'
import type { CommerceMobileContext } from '../data/context'
import { adjustStock, STOCK_REASONS } from '../data/products'
import { Stepper } from '../ui/controls'
import { Fact, FilterChips, showError } from '../ui/parts'

/*
 * A stock count from the stockroom (AGL-3621): units in or out, why, and at
 * which location when the variant is counted per location. The move and its
 * ledger row are one transaction over the live product, so a sale that lands
 * while the sheet is open is never overwritten.
 */

type Direction = 'in' | 'out'
const DIRECTIONS: ReadonlyArray<{ id: Direction; label: string }> = [
  { id: 'in', label: 'Add units' },
  { id: 'out', label: 'Remove units' },
]

/** The locations a site counts stock at, by id, as the console's locations card lists them. */
async function readLocations(commerce: CommerceMobileContext): Promise<Record<string, string>> {
  const snapshot = await getDocs(query(collection(commerce.firestore, 'hosts', commerce.hostId, 'locations'), limit(25)))
  return Object.fromEntries(snapshot.docs.map((entry) => [entry.id, String(entry.get('name') ?? '') || 'Location']))
}

export function StockSheet({
  visible,
  commerce,
  productId,
  product,
  variantId,
  onClose,
  onDone,
}: {
  visible: boolean
  commerce: CommerceMobileContext
  productId: string
  product: HostProduct
  variantId: string | null
  onClose: () => void
  onDone: () => void
}) {
  const theme = useMobileTheme()
  const variant = product.variants.find((entry) => entry.id === variantId) ?? null
  const buckets = variant?.inventoryByLocation ? Object.keys(variant.inventoryByLocation) : []
  const locations = useQuery({
    queryKey: ['commerce', commerce.hostId, 'locations'],
    queryFn: () => readLocations(commerce),
    enabled: visible && buckets.length > 0,
    staleTime: 5 * 60_000,
  })
  const [direction, setDirection] = useState<Direction>('in')
  const [units, setUnits] = useState(1)
  const [reason, setReason] = useState<InventoryAdjustmentReason>('restock')
  const [locationId, setLocationId] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setDirection('in')
    setUnits(1)
    setReason('restock')
    setLocationId(buckets[0] ?? null)
    // Reset on opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, variantId])

  const submit = useMutation({
    mutationFn: () =>
      adjustStock(commerce, {
        productId,
        variantId: variantId as string,
        delta: direction === 'in' ? units : -units,
        reason,
        ...(locationId ? { locationId } : {}),
      }),
    onSuccess: onDone,
    onError: (error) => showError('Stock was not changed', errorText(error)),
  })

  if (!variant) return null
  const current = locationId && variant.inventoryByLocation ? (variant.inventoryByLocation[locationId] ?? 0) : (variant.inventory ?? 0)

  return (
    <Sheet visible={visible} onClose={onClose} title="Adjust stock">
      <View style={{ padding: theme.space(2), gap: theme.space(2) }}>
        <Fact label={locationId ? `At ${locations.data?.[locationId] ?? 'this location'}` : 'In stock now'} value={String(current)} strong />
        <View style={{ marginHorizontal: -theme.space(2) }}>
          <FilterChips
            testID="stock-direction"
            options={DIRECTIONS}
            value={direction}
            onChange={(next) => {
              setDirection(next)
              setReason(next === 'in' ? 'restock' : 'damage')
            }}
          />
          {buckets.length > 1 ? (
            <FilterChips
              testID="stock-location"
              options={buckets.map((id) => ({ id, label: locations.data?.[id] ?? 'Location' }))}
              value={locationId ?? buckets[0]}
              onChange={setLocationId}
            />
          ) : null}
          <FilterChips testID="stock-reason" options={STOCK_REASONS} value={reason} onChange={setReason} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(2) }}>
          <Text style={{ flex: 1 }}>Units</Text>
          <Stepper testID="stock-units" label="units" value={units} min={1} onChange={setUnits} />
        </View>
        <TextField
          label="Or type a number of units"
          keyboardType="number-pad"
          value={String(units)}
          onChangeText={(text) => {
            const next = Math.round(Number(text.replace(/\D/g, '')))
            setUnits(Number.isFinite(next) && next > 0 ? next : 1)
          }}
        />
        {direction === 'out' && units > current ? (
          <Text variant="caption" tone="secondary">
            Only {current} on hand; the count stops at zero.
          </Text>
        ) : null}
        <Button
          testID="stock-submit"
          title={`${direction === 'in' ? 'Add' : 'Remove'} ${units} unit${units === 1 ? '' : 's'}`}
          icon="layers-outline"
          busy={submit.isPending}
          onPress={() => submit.mutate()}
        />
      </View>
    </Sheet>
  )
}
