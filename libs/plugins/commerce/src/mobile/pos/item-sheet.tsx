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

import { Button, Icon, Sheet, Text, useMobileTheme } from '@aglyn/mobile-ui'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { type ModifierSelection, modifierGroupRequired } from '../../lib/model/product-modifiers'
import { POS_LINE_MAX_QUANTITY, type PosCartPick } from './cart'
import { pickOf, type PosItem, type PosVariant, variantSoldOut } from './catalog'

/*==========================================
 * THE ITEM SHEET (AGL-3618): a product's options as one-tap choices, its
 * modifier groups (required ones marked, a pick-one group behaving as one),
 * a quantity, and Add with the line's price. The same resolver the server
 * prices modifiers with checks the choices here, so Add is refused for the
 * same reasons the sale would be.
 *=========================================*/

export function ItemSheet(props: {
  item: PosItem | null
  money: (cents: number) => string
  onClose: () => void
  onAdd: (pick: PosCartPick, quantity: number, variant: PosVariant) => void
}) {
  const theme = useMobileTheme()
  const item = props.item
  const [variantId, setVariantId] = useState<string | null>(null)
  const [picks, setPicks] = useState<ModifierSelection[]>([])
  const [quantity, setQuantity] = useState(1)

  useEffect(() => {
    setVariantId(item?.variants.length === 1 ? item.variants[0].id : null)
    setPicks([])
    setQuantity(1)
  }, [item])

  if (!item) return <Sheet visible={false} onClose={props.onClose} title="">{null}</Sheet>
  const variant = item.variants.find((entry) => entry.id === variantId) ?? null
  const pick = variant ? pickOf(item, variant, picks) : null
  const problem = !variant ? 'Choose an option.' : pick && 'problem' in pick ? pick.problem : null

  const toggle = (groupId: string, optionId: string, max: number) => {
    setPicks((current) => {
      const has = current.some((entry) => entry.groupId === groupId && entry.optionId === optionId)
      if (has) return current.filter((entry) => !(entry.groupId === groupId && entry.optionId === optionId))
      const inGroup = current.filter((entry) => entry.groupId === groupId)
      // A pick-one group swaps its choice; a fuller group refuses one more.
      if (max === 1) return [...current.filter((entry) => entry.groupId !== groupId), { groupId, optionId }]
      if (inGroup.length >= max) return current
      return [...current, { groupId, optionId }]
    })
  }

  const chip = (selected: boolean) => ({
    paddingHorizontal: theme.space(1.5),
    minHeight: 44,
    justifyContent: 'center' as const,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: selected ? theme.colors.primary.main : theme.colors.divider,
    backgroundColor: selected ? theme.colors.primary.main : 'transparent',
  })

  return (
    <Sheet visible onClose={props.onClose} title={item.name}>
      <View style={{ padding: theme.space(2), gap: theme.space(2) }} testID="item-sheet">
        {item.variants.length > 1 ? (
          <View style={{ gap: theme.space(1) }}>
            <Text variant="label">Option</Text>
            <View style={[styles.wrap, { gap: theme.space(1) }]}>
              {item.variants.map((entry) => {
                const selected = entry.id === variantId
                return (
                  <Pressable
                    key={entry.id}
                    testID={`variant-${entry.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setVariantId(entry.id)}
                    style={chip(selected)}
                  >
                    <Text variant="label" style={{ color: selected ? theme.colors.primary.contrastText : theme.colors.text.primary }}>
                      {entry.label ?? 'Standard'}
                    </Text>
                    <Text
                      variant="caption"
                      style={{ color: selected ? theme.colors.primary.contrastText : theme.colors.text.secondary }}
                    >
                      {entry.unitCents === null ? 'No price' : props.money(entry.unitCents)}
                      {variantSoldOut(entry) ? ' · none in stock' : ''}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        ) : null}

        {item.modifierGroups.map((group) => (
          <View key={group.id} style={{ gap: theme.space(1) }}>
            <Text variant="label">
              {group.name}
              {modifierGroupRequired(group) ? ' · required' : ''}
              {group.max > 1 ? ` · up to ${group.max}` : ''}
            </Text>
            <View style={[styles.wrap, { gap: theme.space(1) }]}>
              {group.options.map((option) => {
                const selected = picks.some((entry) => entry.groupId === group.id && entry.optionId === option.id)
                return (
                  <Pressable
                    key={option.id}
                    testID={`modifier-${group.id}-${option.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => toggle(group.id, option.id, group.max)}
                    style={chip(selected)}
                  >
                    <Text variant="label" style={{ color: selected ? theme.colors.primary.contrastText : theme.colors.text.primary }}>
                      {option.name}
                      {option.priceCents ? ` +${props.money(option.priceCents)}` : ''}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        ))}

        <View style={[styles.row, { gap: theme.space(2) }]}>
          <Text variant="label" style={{ flex: 1 }}>
            Quantity
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="One fewer"
            disabled={quantity <= 1}
            onPress={() => setQuantity((value) => Math.max(1, value - 1))}
          >
            <Icon name="remove-circle-outline" size={32} />
          </Pressable>
          <Text variant="heading" testID="item-quantity">
            {quantity}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="One more"
            onPress={() => setQuantity((value) => Math.min(POS_LINE_MAX_QUANTITY, value + 1))}
          >
            <Icon name="add-circle-outline" size={32} color={theme.colors.primary.main} />
          </Pressable>
        </View>

        {problem && variant ? (
          <Text variant="caption" tone="error">
            {problem}
          </Text>
        ) : null}
        <Button
          testID="item-add"
          title={
            pick && !('problem' in pick) ? `Add · ${props.money(pick.unitCents * quantity)}` : 'Add to sale'
          }
          disabled={Boolean(problem)}
          onPress={() => {
            if (variant && pick && !('problem' in pick)) props.onAdd(pick, quantity, variant)
          }}
        />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center' },
})
