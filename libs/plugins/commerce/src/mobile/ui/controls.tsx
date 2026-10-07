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
import { Pressable, StyleSheet, Switch, View } from 'react-native'

/*
 * Form controls the UI kit does not carry yet (AGL-3621): a count stepper,
 * a labeled switch and a checkbox row, drawn from the theme.
 */

export function Stepper({
  value,
  min = 0,
  max,
  onChange,
  label,
  testID,
}: {
  value: number
  min?: number
  max?: number
  onChange: (next: number) => void
  label: string
  testID?: string
}) {
  const theme = useMobileTheme()
  const button = (icon: string, next: number, disabled: boolean, suffix: string) => (
    <Pressable
      testID={testID ? `${testID}-${suffix}` : undefined}
      accessibilityRole="button"
      accessibilityLabel={`${suffix === 'down' ? 'Fewer' : 'More'} ${label}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onChange(next)}
      style={[
        styles.step,
        { borderColor: theme.colors.divider, borderRadius: theme.radius, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <Icon name={icon} size={18} color={theme.colors.primary.text} />
    </Pressable>
  )
  return (
    <View style={styles.row} accessibilityLabel={label} accessibilityValue={{ now: value, min, max }}>
      {button('remove', Math.max(min, value - 1), value <= min, 'down')}
      <Text variant="label" testID={testID ? `${testID}-value` : undefined} style={styles.value}>
        {value}
      </Text>
      {button('add', max == null ? value + 1 : Math.min(max, value + 1), max != null && value >= max, 'up')}
    </View>
  )
}

export function SwitchRow({
  label,
  hint,
  value,
  onChange,
  testID,
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (next: boolean) => void
  testID?: string
}) {
  const theme = useMobileTheme()
  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <Text>{label}</Text>
        {hint ? (
          <Text variant="caption" tone="secondary">
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: theme.colors.primary.main, false: theme.colors.divider }}
      />
    </View>
  )
}

export function CheckRow({
  label,
  detail,
  checked,
  onToggle,
  testID,
}: {
  label: string
  detail?: string
  checked: boolean
  onToggle: () => void
  testID?: string
}) {
  const theme = useMobileTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={[styles.row, { paddingVertical: theme.space(1) }]}
    >
      <Icon name={checked ? 'checkbox' : 'square-outline'} color={checked ? theme.colors.primary.main : undefined} />
      <View style={styles.flex}>
        <Text>{label}</Text>
        {detail ? (
          <Text variant="caption" tone="secondary">
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  step: { width: 36, height: 36, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  value: { minWidth: 28, textAlign: 'center' },
})
