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
import { useNavigation } from '@react-navigation/native'
import { useCallback, type ReactNode } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'

/*
 * Small pieces the commerce screens share (AGL-3621), drawn only from the
 * app's theme: the status chips over a list, a status pill, a label and value
 * row, and the confirm every irreversible action asks first.
 */

export interface ChipOption<T extends string> {
  id: T
  label: string
}

/** One row of single-choice chips, scrolling sideways on a phone. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: readonly ChipOption<T>[]
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

/** A label on the left and its value on the right, as a detail card lists facts. */
export function Fact({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <View style={styles.fact}>
      <Text tone="secondary" style={styles.flex}>
        {label}
      </Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text variant={strong ? 'label' : 'body'}>{value}</Text>
      ) : (
        value
      )}
    </View>
  )
}

/** A compact icon button for a card header. */
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
export function confirmAction(input: {
  title: string
  body?: string
  confirm: string
  destructive?: boolean
}): Promise<boolean> {
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

/**
 * Leaves the screen when it was pushed, as after a save on a phone. A screen
 * shown inside a split view has nowhere to go back to and stays put.
 */
export function useLeave(): () => void {
  const navigation = useNavigation()
  return useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack()
  }, [navigation])
}

const styles = StyleSheet.create({
  chip: { minHeight: 32, borderWidth: 1, justifyContent: 'center' },
  pill: { borderWidth: 1, alignSelf: 'flex-start', paddingVertical: 2 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 28 },
  flex: { flex: 1 },
})
