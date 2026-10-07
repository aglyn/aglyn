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
import { Icon, Text, useMobileTheme } from '@aglyn/mobile-ui'
import type { ReactNode } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import type { BookingRow } from './data/bookings'

/*
 * Small pieces the Bookings screens share (AGL-3621), drawn only from the
 * app's theme: single-choice chips, a state pill, a label and value row,
 * and the confirm every irreversible action asks first.
 */

export function Chips<T extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: ReadonlyArray<{ id: T; label: string }>
  value: NoInfer<T>
  onChange: (next: NoInfer<T>) => void
  testID?: string
}) {
  const theme = useMobileTheme()
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      testID={testID}
      contentContainerStyle={{ paddingHorizontal: theme.space(2), paddingVertical: theme.space(1), gap: theme.space(1) }}
    >
      {options.map((option) => {
        const selected = option.id === value
        return (
          <Pressable
            key={option.id}
            testID={testID ? `${testID}-${option.id}` : undefined}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            style={[
              styles.chip,
              {
                borderRadius: theme.radius * 4,
                paddingHorizontal: theme.space(1.5),
                borderColor: selected ? theme.colors.primary.main : theme.colors.divider,
                backgroundColor: selected ? theme.colors.primary.main : theme.colors.background.paper,
              },
            ]}
          >
            <Text variant="caption" tone={selected ? 'inverse' : 'primary'}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

export type PillTone = 'success' | 'warning' | 'error' | 'info' | 'neutral'

export function Pill({ label, tone = 'neutral', testID }: { label: string; tone?: PillTone; testID?: string }) {
  const theme = useMobileTheme()
  const color =
    tone === 'neutral'
      ? { main: theme.colors.divider, text: theme.colors.text.secondary }
      : { main: theme.colors[tone].main, text: theme.colors[tone].text }
  return (
    <View
      testID={testID}
      style={[styles.pill, { borderColor: color.main, borderRadius: theme.radius * 4, paddingHorizontal: theme.space(1) }]}
    >
      <Text variant="caption" style={{ color: color.text }}>
        {label}
      </Text>
    </View>
  )
}

/** The pill a booking wears in a list and on its detail. */
export function BookingPill({ row }: { row: Pick<BookingRow, 'state' | 'stateLabel' | 'checkedInAtMs'> }) {
  if (row.checkedInAtMs) return <Pill testID="booking-state" label="Checked in" tone="success" />
  const tone: PillTone =
    row.state === 'confirmed' ? 'info' : row.state === 'pendingPayment' ? 'warning' : 'neutral'
  return <Pill testID="booking-state" label={row.stateLabel} tone={tone} />
}

export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.fact}>
      <Text tone="secondary" style={styles.flex}>
        {label}
      </Text>
      {typeof value === 'string' ? <Text>{value}</Text> : value}
    </View>
  )
}

/** A compact icon button for a header. */
export function IconAction({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: string
  label: string
  onPress: () => void
  testID?: string
}) {
  const theme = useMobileTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      style={{ padding: theme.space(0.5) }}
    >
      <Icon name={icon} color={theme.colors.primary.text} />
    </Pressable>
  )
}

/** Asks before an action that cannot be taken back. Resolves true on yes. */
export function confirmAction(input: { title: string; body?: string; confirm: string; destructive?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(input.title, input.body, [
      { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
      { text: input.confirm, style: input.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ])
  })
}

export function showError(title: string, message: string): void {
  Alert.alert(title, message)
}

const styles = StyleSheet.create({
  chip: { minHeight: 32, borderWidth: 1, justifyContent: 'center' },
  pill: { borderWidth: 1, alignSelf: 'flex-start', paddingVertical: 2 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 28 },
  flex: { flex: 1 },
})
