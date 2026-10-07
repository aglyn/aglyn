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

import { Button, EmptyState, Icon, Notice, Skeleton, Text, useMobileTheme } from '@aglyn/mobile-ui'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { Firestore } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { FlatList, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import {
  categoryLevel,
  type PosCategory,
  posCategoriesQuery,
  posGridQuery,
  type PosItem,
  type PosVariant,
  variantSoldOut,
} from './catalog'

/*==========================================
 * THE ITEM GRID (AGL-3618).
 *
 * Built for speed at a counter, the way Square's and Shopify's tills are:
 * the merchant's quick keys (one tap rings the item up), category tiles,
 * then every sellable product as a tile, with a search field and a camera
 * scan above. A tap on a plain product adds it; a product with options or
 * modifiers opens its item sheet. The device reopens on the view it was
 * left on.
 *=========================================*/

export interface CatalogPanelProps {
  firestore: Firestore
  hostId: string
  columns: number
  money: (cents: number) => string
  /** The view the grid opened on last: quick keys, or everything. */
  quickKeys: boolean
  onQuickKeys: (on: boolean) => void
  /** How many of each product the basket holds, for the tile's badge. */
  inCart: Readonly<Record<string, number>>
  onPick: (item: PosItem) => void
  /** Present when the app can scan with the camera. */
  onScan?: () => void
  /** A typed code followed by return: the keyboard-wedge scanner's path. */
  onSubmitCode: (code: string) => void
}

function priceLabel(item: PosItem, money: (cents: number) => string): string {
  if (item.fromCents === null) return 'No price'
  if (item.toCents !== null && item.toCents !== item.fromCents) return `From ${money(item.fromCents)}`
  return money(item.fromCents)
}

export function CatalogPanel(props: CatalogPanelProps) {
  const theme = useMobileTheme()
  const [search, setSearch] = useState('')
  const [typed, setTyped] = useState('')
  const [path, setPath] = useState<PosCategory[]>([])
  const category = path[path.length - 1] ?? null

  // The query runs on the settled word, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 250)
    return () => clearTimeout(timer)
  }, [typed])

  const categories = useQuery(posCategoriesQuery(props.firestore, props.hostId))
  const level = useMemo(
    () => (search || (props.quickKeys && !category) ? [] : categoryLevel(categories.data ?? [], category?.id ?? null)),
    [categories.data, category, search, props.quickKeys],
  )
  const grid = useInfiniteQuery(
    posGridQuery(props.firestore, props.hostId, {
      search,
      categoryId: category?.id ?? null,
      quickKeys: props.quickKeys && !category,
    }),
  )
  const items = useMemo(() => grid.data?.pages.flatMap((page) => page.rows) ?? [], [grid.data])
  const refused = grid.data?.pages[0]?.plan.refused ?? []

  const tile = {
    flex: 1 / props.columns,
    minHeight: 96,
    margin: theme.space(0.5),
    padding: theme.space(1.25),
    borderRadius: theme.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.divider,
    backgroundColor: theme.colors.background.paper,
    justifyContent: 'space-between' as const,
  }

  const header = (
    <View style={{ gap: theme.space(1), paddingBottom: theme.space(1) }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space(1) }}>
        <Button
          testID="grid-quick-keys"
          title="Quick keys"
          icon="flash-outline"
          variant={props.quickKeys && !path.length ? 'contained' : 'outlined'}
          onPress={() => {
            setPath([])
            props.onQuickKeys(true)
          }}
        />
        <Button
          testID="grid-all"
          title="All items"
          icon="grid-outline"
          variant={!props.quickKeys && !path.length ? 'contained' : 'outlined'}
          onPress={() => {
            setPath([])
            props.onQuickKeys(false)
          }}
        />
      </ScrollView>
      {path.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space(1) }}>
          <Button title="Back" variant="text" icon="arrow-back" onPress={() => setPath(path.slice(0, -1))} />
          {path.map((entry, index) => (
            <Button
              key={entry.id}
              title={entry.name}
              variant={index === path.length - 1 ? 'outlined' : 'text'}
              onPress={() => setPath(path.slice(0, index + 1))}
            />
          ))}
        </ScrollView>
      ) : null}
      {level.length ? (
        <View style={styles.wrap} testID="category-tiles">
          {level.map((entry) => (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={`Category ${entry.name}`}
              onPress={() => {
                props.onQuickKeys(false)
                setPath([...path, entry])
              }}
              style={({ pressed }) => ({
                width: `${100 / props.columns}%`,
                padding: theme.space(0.5),
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View
                style={{
                  minHeight: 56,
                  borderRadius: theme.radius,
                  padding: theme.space(1),
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: theme.colors.secondary.main,
                }}
              >
                <Text variant="label" numberOfLines={2} style={{ color: theme.colors.secondary.text }}>
                  {entry.name}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {refused.length ? <Notice tone="warning" message="Search by name, or pick a category, one at a time." /> : null}
    </View>
  )

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space(1),
          paddingHorizontal: theme.space(1),
          paddingVertical: theme.space(1),
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space(1),
            minHeight: 44,
            paddingHorizontal: theme.space(1.5),
            borderRadius: theme.radius,
            borderWidth: 1,
            borderColor: theme.colors.divider,
            backgroundColor: theme.colors.background.paper,
          }}
        >
          <Icon name="search" size={18} />
          <TextInput
            testID="pos-search"
            accessibilityLabel="Search items or type a barcode"
            placeholder="Search items or type a barcode"
            placeholderTextColor={theme.colors.text.disabled}
            value={typed}
            onChangeText={setTyped}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            onSubmitEditing={() => {
              const code = typed.trim()
              if (!code) return
              props.onSubmitCode(code)
              setTyped('')
            }}
            style={[theme.type.body, { flex: 1, color: theme.colors.text.primary }]}
          />
          {typed ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setTyped('')} hitSlop={8}>
              <Icon name="close-circle" size={18} />
            </Pressable>
          ) : null}
        </View>
        {props.onScan ? (
          <Pressable
            testID="pos-scan"
            accessibilityRole="button"
            accessibilityLabel="Scan a barcode"
            onPress={props.onScan}
            style={{
              width: 44,
              height: 44,
              borderRadius: theme.radius,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.primary.main,
            }}
          >
            <Icon name="barcode-outline" color={theme.colors.primary.contrastText} />
          </Pressable>
        ) : null}
      </View>
      <FlatList
        key={`grid-${props.columns}`}
        testID="pos-grid"
        data={items}
        numColumns={props.columns}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: theme.space(0.5), paddingBottom: theme.space(12) }}
        ListHeaderComponent={<View style={{ paddingHorizontal: theme.space(0.5) }}>{header}</View>}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (grid.hasNextPage && !grid.isFetchingNextPage) void grid.fetchNextPage()
        }}
        ListEmptyComponent={
          grid.isPending ? (
            <View style={{ gap: theme.space(1), padding: theme.space(1) }}>
              <Skeleton height={96} />
              <Skeleton height={96} />
            </View>
          ) : grid.isError ? (
            <Notice
              tone="error"
              message="The catalog could not be loaded."
              action={{ label: 'Retry', onPress: () => void grid.refetch() }}
            />
          ) : (
            <EmptyState
              icon="pricetags-outline"
              title={
                search
                  ? `Nothing matches “${search}”`
                  : props.quickKeys && !category
                    ? 'No quick keys yet'
                    : 'No items to sell'
              }
              body={
                search
                  ? undefined
                  : props.quickKeys && !category
                    ? 'Turn on “Quick key at the register” for a product in the console’s product editor, or open All items.'
                    : 'Active products in the store show here.'
              }
              action={
                props.quickKeys && !category && !search ? (
                  <Button title="All items" variant="outlined" onPress={() => props.onQuickKeys(false)} />
                ) : undefined
              }
            />
          )
        }
        renderItem={({ item }) => {
          const soldOut = item.variants.every((variant: PosVariant) => variantSoldOut(variant))
          return (
            <Pressable
              testID={`pos-item-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${priceLabel(item, props.money)}${soldOut ? ', sold out' : ''}`}
              accessibilityHint={item.variants.length > 1 || item.modifierGroups.length ? 'Opens its options.' : 'Adds it to the sale.'}
              onPress={() => props.onPick(item)}
              style={({ pressed }) => [tile, { opacity: pressed ? 0.7 : 1 }]}
            >
              {item.imageUrl ? (
                <Image
                  source={{ uri: item.imageUrl }}
                  accessibilityIgnoresInvertColors
                  style={{ width: '100%', height: 64, borderRadius: theme.radius / 2, marginBottom: theme.space(0.5) }}
                  resizeMode="cover"
                />
              ) : null}
              <Text variant="label" numberOfLines={2}>
                {item.name}
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="caption" tone="secondary">
                  {priceLabel(item, props.money)}
                </Text>
                {props.inCart[item.id] ? (
                  <View
                    style={{
                      minWidth: 22,
                      paddingHorizontal: 6,
                      borderRadius: 11,
                      backgroundColor: theme.colors.primary.main,
                      alignItems: 'center',
                    }}
                  >
                    <Text variant="caption" style={{ color: theme.colors.primary.contrastText }}>
                      {props.inCart[item.id]}
                    </Text>
                  </View>
                ) : soldOut ? (
                  <Text variant="caption" tone="error">
                    Sold out
                  </Text>
                ) : item.variants.length > 1 ? (
                  <Text variant="caption" tone="secondary">
                    {item.variants.length} options
                  </Text>
                ) : null}
              </View>
            </Pressable>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
})
