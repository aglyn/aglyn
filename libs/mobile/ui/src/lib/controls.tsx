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

/**
 * List controls (AGL-3622): the React Native counterparts of the MUI chip,
 * the list search box and a growing list's footer, which every native list
 * screen needs. Colors, sizes and radii come from the theme.
 */

import { type ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Button, Icon, Text } from './components'
import { useMobileTheme, type MobileTheme } from './theme'

export type ChipTone = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'

function toneColors(theme: MobileTheme, tone: ChipTone) {
  if (tone === 'default') return { ground: theme.colors.background.paper, fg: theme.colors.text.secondary, border: theme.colors.divider }
  const palette = theme.colors[tone]
  return { ground: theme.colors.background.paper, fg: palette.text, border: palette.main }
}

/** A small label or a toggle: a status, a filter, a choice. */
export function Chip({
  label,
  tone = 'default',
  selected,
  onPress,
  icon,
  testID,
}: {
  label: string
  tone?: ChipTone
  selected?: boolean
  onPress?: () => void
  icon?: string
  testID?: string
}) {
  const theme = useMobileTheme()
  const colors = toneColors(theme, selected ? 'primary' : tone)
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={onPress ? { selected: Boolean(selected) } : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderRadius: theme.radius * 4,
          paddingHorizontal: theme.space(1.25),
          gap: theme.space(0.5),
          borderColor: colors.border,
          backgroundColor: selected ? theme.colors.primary.main : colors.ground,
        },
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={selected ? theme.colors.primary.contrastText : colors.fg} /> : null}
      <Text variant="caption" style={{ color: selected ? theme.colors.primary.contrastText : colors.fg }}>
        {label}
      </Text>
    </Pressable>
  )
}

/** One-of choices as a scrolling row of chips (a list's quick filters). */
export function ChipRow<V extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: readonly { value: V; label: string }[]
  value: V
  onChange: (value: V) => void
  testID?: string
}) {
  const theme = useMobileTheme()
  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: theme.space(1), paddingHorizontal: theme.space(2), paddingVertical: theme.space(1) }}
    >
      {options.map((option) => (
        <Chip
          key={option.value}
          testID={testID ? `${testID}-${option.value}` : undefined}
          label={option.label}
          selected={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </ScrollView>
  )
}

/** A list's search box. */
export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  testID,
}: {
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  testID?: string
}) {
  const theme = useMobileTheme()
  return (
    <View
      style={[
        styles.search,
        {
          marginHorizontal: theme.space(2),
          marginTop: theme.space(1),
          paddingHorizontal: theme.space(1.5),
          gap: theme.space(1),
          borderRadius: theme.radius,
          borderColor: theme.colors.divider,
          backgroundColor: theme.colors.background.paper,
        },
      ]}
    >
      <Icon name="search" size={18} />
      <TextInput
        testID={testID}
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.text.disabled}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={[theme.type.body, styles.flex, { color: theme.colors.text.primary }]}
      />
    </View>
  )
}

/** What a list says below its rows: more is loading, or a button for more. */
export function ListFooter({
  hasMore,
  loading,
  onLoadMore,
  children,
}: {
  hasMore: boolean
  loading?: boolean
  onLoadMore: () => void
  children?: ReactNode
}) {
  const theme = useMobileTheme()
  return (
    <View style={{ padding: theme.space(2), gap: theme.space(1) }}>
      {loading ? <ActivityIndicator color={theme.colors.primary.main} /> : null}
      {!loading && hasMore ? <Button title="Show more" variant="text" onPress={onLoadMore} /> : null}
      {children}
    </View>
  )
}

/** A label and its value, for a record's detail. */
export function Field({ label, value, testID }: { label: string; value: ReactNode; testID?: string }) {
  const theme = useMobileTheme()
  return (
    <View testID={testID} style={{ gap: theme.space(0.25) }}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      {typeof value === 'string' || typeof value === 'number' ? <Text>{String(value)}</Text> : value}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', minHeight: 32, borderWidth: 1 },
  search: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderWidth: 1 },
})
