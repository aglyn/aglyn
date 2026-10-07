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

import { Button, EmptyState, Icon, Sheet, Text, TextField, useMobileTheme } from '@aglyn/mobile-ui'
import { useState } from 'react'
import { FlatList, Pressable, StyleSheet, View } from 'react-native'
import {
  cartCount,
  cartDiscountCents,
  type PosCart,
  type PosCartLine,
  cartSubtotalCents,
} from './cart'

/*==========================================
 * THE BASKET (AGL-3618): what is rung up, each line's count, a whole-sale
 * discount, and Charge. The figures are the preview; the server prices the
 * sale when it opens, with the store's tax, and the checkout shows that.
 *=========================================*/

const DISCOUNT_PRESETS = [0, 5, 10, 15, 20]

export function CartPanel(props: {
  cart: PosCart
  money: (cents: number) => string
  onQuantity: (key: string, quantity: number) => void
  onDiscount: (pct: number) => void
  onClear: () => void
  onCharge: () => void
  /** Why Charge is held (offline, no register), or null. */
  chargeBlocked: string | null
  charging: boolean
}) {
  const theme = useMobileTheme()
  const [discountOpen, setDiscountOpen] = useState(false)
  const [customPct, setCustomPct] = useState('')
  const subtotal = cartSubtotalCents(props.cart)
  const discount = cartDiscountCents(props.cart)
  const count = cartCount(props.cart)

  const line = ({ item }: { item: PosCartLine }) => (
    <View
      testID={`cart-line-${item.key}`}
      style={[
        styles.line,
        { paddingVertical: theme.space(1), gap: theme.space(1), borderBottomColor: theme.colors.divider },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={2}>
          {item.name}
        </Text>
        {item.variantLabel ? (
          <Text variant="caption" tone="secondary">
            {item.variantLabel}
          </Text>
        ) : null}
        <Text variant="caption" tone="secondary">
          {props.money(item.unitCents)} each
        </Text>
      </View>
      <View style={[styles.stepper, { gap: theme.space(0.5) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`One fewer ${item.name}`}
          onPress={() => props.onQuantity(item.key, item.quantity - 1)}
          hitSlop={6}
          style={styles.stepButton}
        >
          <Icon name={item.quantity === 1 ? 'trash-outline' : 'remove-circle-outline'} size={26} />
        </Pressable>
        <Text variant="label" testID={`cart-qty-${item.key}`} style={{ minWidth: 24, textAlign: 'center' }}>
          {item.quantity}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`One more ${item.name}`}
          onPress={() => props.onQuantity(item.key, item.quantity + 1)}
          hitSlop={6}
          style={styles.stepButton}
        >
          <Icon name="add-circle-outline" size={26} color={theme.colors.primary.main} />
        </Pressable>
      </View>
      <Text variant="label" style={{ minWidth: 72, textAlign: 'right' }}>
        {props.money(item.unitCents * item.quantity)}
      </Text>
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.default }} testID="cart-panel">
      <View style={[styles.header, { padding: theme.space(1.5) }]}>
        <Text variant="heading" style={{ flex: 1 }}>
          {count ? `Sale · ${count} item${count === 1 ? '' : 's'}` : 'Sale'}
        </Text>
        {count ? <Button title="Clear" variant="text" onPress={props.onClear} /> : null}
      </View>
      <FlatList
        data={props.cart.lines}
        keyExtractor={(entry) => entry.key}
        renderItem={line}
        contentContainerStyle={{ paddingHorizontal: theme.space(1.5) }}
        ListEmptyComponent={
          <EmptyState icon="cart-outline" title="No items yet" body="Tap an item, scan a barcode or use a quick key." />
        }
      />
      <View
        style={{
          padding: theme.space(1.5),
          gap: theme.space(0.75),
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.divider,
          backgroundColor: theme.colors.background.paper,
        }}
      >
        <Row label="Subtotal" value={props.money(subtotal)} />
        <Pressable accessibilityRole="button" onPress={() => setDiscountOpen(true)} testID="cart-discount">
          <Row
            label={props.cart.discountPct ? `Discount (${props.cart.discountPct}%)` : 'Add a discount'}
            value={discount ? `−${props.money(discount)}` : ''}
            accent
          />
        </Pressable>
        <Text variant="caption" tone="secondary">
          Tax is added when you charge.
        </Text>
        {props.chargeBlocked ? (
          <Text variant="caption" tone="error">
            {props.chargeBlocked}
          </Text>
        ) : null}
        <Button
          testID="cart-charge"
          title={count ? `Charge ${props.money(Math.max(0, subtotal - discount))}` : 'Charge'}
          icon="card-outline"
          onPress={props.onCharge}
          busy={props.charging}
          disabled={!count || Boolean(props.chargeBlocked)}
        />
      </View>
      <Sheet visible={discountOpen} onClose={() => setDiscountOpen(false)} title="Discount the whole sale">
        <View style={{ padding: theme.space(2), gap: theme.space(1.5) }}>
          <View style={[styles.wrap, { gap: theme.space(1) }]}>
            {DISCOUNT_PRESETS.map((pct) => (
              <Button
                key={pct}
                title={pct ? `${pct}%` : 'None'}
                variant={props.cart.discountPct === pct ? 'contained' : 'outlined'}
                onPress={() => {
                  props.onDiscount(pct)
                  setDiscountOpen(false)
                }}
              />
            ))}
          </View>
          <TextField
            label="Another percentage"
            keyboardType="number-pad"
            value={customPct}
            onChangeText={setCustomPct}
            placeholder="e.g. 12"
          />
          <Button
            title="Apply"
            variant="outlined"
            disabled={!/^\d{1,3}$/.test(customPct.trim()) || Number(customPct) > 100}
            onPress={() => {
              props.onDiscount(Number(customPct))
              setCustomPct('')
              setDiscountOpen(false)
            }}
          />
          <Text variant="caption" tone="secondary">
            The store’s discount limit applies. A larger discount is refused when you charge.
          </Text>
        </View>
      </Sheet>
    </View>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.row}>
      <Text variant="body" tone={accent ? 'accent' : 'secondary'} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="body">{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepButton: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
})
