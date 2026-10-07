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
 * The basic mobile components (AGL-3620): the React Native counterparts of
 * the MUI basics the console is built from. Every color, size and radius
 * comes from the theme; a component that needs a value the theme lacks is a
 * missing token, not a literal.
 */

import Ionicons from '@expo/vector-icons/Ionicons'
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text as NativeText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useMobileTheme, type MobileTheme } from './theme'

export type IconName = ComponentProps<typeof Ionicons>['name']

export function Icon({ name, size = 22, color }: { name: string; size?: number; color?: string }) {
  const theme = useMobileTheme()
  return <Ionicons name={name as IconName} size={size} color={color ?? theme.colors.text.secondary} />
}

export function Text({
  variant = 'body',
  tone = 'primary',
  style,
  children,
  numberOfLines,
  testID,
}: {
  testID?: string
  variant?: keyof MobileTheme['type']
  tone?: 'primary' | 'secondary' | 'accent' | 'error' | 'inverse'
  style?: StyleProp<TextStyle>
  children: ReactNode
  numberOfLines?: number
}) {
  const theme = useMobileTheme()
  const color = {
    primary: theme.colors.text.primary,
    secondary: theme.colors.text.secondary,
    accent: theme.colors.primary.text,
    error: theme.colors.error.text,
    inverse: theme.colors.primary.contrastText,
  }[tone]
  return (
    <NativeText testID={testID} numberOfLines={numberOfLines} style={[theme.type[variant], { color }, style]}>
      {children}
    </NativeText>
  )
}

/** A scrolling screen body on the page ground. */
export function Screen({
  children,
  scroll = true,
  padded = true,
  style,
}: {
  children: ReactNode
  scroll?: boolean
  padded?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const theme = useMobileTheme()
  const ground = { backgroundColor: theme.colors.background.default }
  const pad = padded ? { padding: theme.space(2), gap: theme.space(2) } : null
  if (!scroll) return <View style={[styles.fill, ground, pad, style]}>{children}</View>
  return (
    <ScrollView style={[styles.fill, ground]} contentContainerStyle={[pad, style]}>
      {children}
    </ScrollView>
  )
}

/** A surface. `actions` sit in the header, beside the title (the console's card rule). */
export function Card({
  title,
  actions,
  children,
  style,
}: {
  title?: string
  actions?: ReactNode
  children?: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const theme = useMobileTheme()
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.background.paper,
          borderRadius: theme.radius,
          borderColor: theme.colors.divider,
          padding: theme.space(2),
          gap: theme.space(1.5),
        },
        style,
      ]}
    >
      {title || actions ? (
        <View style={styles.cardHeader}>
          {title ? (
            <Text variant="label" style={styles.flex}>
              {title}
            </Text>
          ) : (
            <View style={styles.flex} />
          )}
          {actions}
        </View>
      ) : null}
      {children}
    </View>
  )
}

export function ListRow({
  title,
  subtitle,
  icon,
  trailing,
  onPress,
  selected,
  testID,
}: {
  title: string
  subtitle?: string
  icon?: string
  trailing?: ReactNode
  onPress?: () => void
  selected?: boolean
  testID?: string
}) {
  const theme = useMobileTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={selected ? { selected: true } : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        {
          paddingHorizontal: theme.space(2),
          paddingVertical: theme.space(1.5),
          gap: theme.space(1.5),
          borderBottomColor: theme.colors.divider,
          backgroundColor: selected
            ? theme.colors.background.paper
            : pressed
              ? theme.colors.background.paper
              : 'transparent',
        },
      ]}
    >
      {icon ? <Icon name={icon} color={selected ? theme.colors.primary.text : undefined} /> : null}
      <View style={styles.flex}>
        <Text variant="body" numberOfLines={1} tone={selected ? 'accent' : 'primary'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ?? (onPress ? <Icon name="chevron-forward" size={18} /> : null)}
    </Pressable>
  )
}

/** A setting that is on or off: a `ListRow` whose trailing control is a themed switch. */
export function SwitchRow({
  title,
  subtitle,
  icon,
  value,
  onValueChange,
  disabled,
  testID,
}: {
  title: string
  subtitle?: string
  icon?: string
  value: boolean
  onValueChange: (next: boolean) => void
  disabled?: boolean
  testID?: string
}) {
  const theme = useMobileTheme()
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      icon={icon}
      trailing={
        <Switch
          testID={testID}
          accessibilityLabel={title}
          value={value}
          disabled={disabled}
          onValueChange={onValueChange}
          trackColor={{ true: theme.colors.primary.main, false: theme.colors.divider }}
        />
      }
    />
  )
}

export function Button({
  title,
  onPress,
  variant = 'contained',
  disabled,
  busy,
  icon,
  testID,
}: {
  title: string
  onPress: () => void
  variant?: 'contained' | 'outlined' | 'text'
  disabled?: boolean
  busy?: boolean
  icon?: string
  testID?: string
}) {
  const theme = useMobileTheme()
  const contained = variant === 'contained'
  const fg = contained ? theme.colors.primary.contrastText : theme.colors.primary.text
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || busy), busy: Boolean(busy) }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          borderRadius: theme.radius,
          paddingHorizontal: theme.space(2),
          minHeight: 44,
          gap: theme.space(1),
          opacity: disabled ? 0.5 : 1,
          backgroundColor: contained
            ? pressed
              ? theme.colors.primary.pressed
              : theme.colors.primary.main
            : 'transparent',
          borderWidth: variant === 'outlined' ? 1 : 0,
          borderColor: theme.colors.primary.main,
        },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} color={fg} size={18} /> : null}
      <Text variant="label" style={{ color: fg }}>
        {title}
      </Text>
    </Pressable>
  )
}

export function TextField({
  label,
  error,
  ...input
}: TextInputProps & { label: string; error?: string | null }) {
  const theme = useMobileTheme()
  return (
    <View style={{ gap: theme.space(0.5) }}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.text.disabled}
        {...input}
        style={[
          theme.type.body,
          styles.input,
          {
            color: theme.colors.text.primary,
            backgroundColor: theme.colors.background.paper,
            borderColor: error ? theme.colors.error.main : theme.colors.divider,
            borderRadius: theme.radius,
            paddingHorizontal: theme.space(1.5),
          },
        ]}
      />
      {error ? (
        <Text variant="caption" tone="error">
          {error}
        </Text>
      ) : null}
    </View>
  )
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  body,
  action,
}: {
  icon?: string
  title: string
  body?: string
  action?: ReactNode
}) {
  const theme = useMobileTheme()
  return (
    <View style={[styles.empty, { padding: theme.space(4), gap: theme.space(1) }]}>
      <Icon name={icon} size={40} />
      <Text variant="heading" style={styles.center}>
        {title}
      </Text>
      {body ? (
        <Text tone="secondary" style={styles.center}>
          {body}
        </Text>
      ) : null}
      {action}
    </View>
  )
}

/**
 * A one-line state the screen is in (AGL-3618): offline, test mode, a
 * refusal to read out. Tinted by tone from the console palette, with at most
 * one action beside the words.
 */
export function Notice({
  tone = 'info',
  message,
  action,
  testID,
}: {
  tone?: 'info' | 'success' | 'warning' | 'error'
  message: string
  action?: { label: string; onPress: () => void }
  testID?: string
}) {
  const theme = useMobileTheme()
  const color = theme.colors[tone]
  const icon = { info: 'information-circle', success: 'checkmark-circle', warning: 'warning', error: 'alert-circle' }[tone]
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={[
        styles.notice,
        {
          borderRadius: theme.radius,
          borderColor: color.main,
          backgroundColor: theme.colors.background.paper,
          paddingHorizontal: theme.space(1.5),
          paddingVertical: theme.space(1),
          gap: theme.space(1),
        },
      ]}
    >
      <Icon name={icon} size={20} color={color.text} />
      <Text variant="caption" style={[styles.flex, { color: color.text }]}>
        {message}
      </Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={8}>
          <Text variant="label" style={{ color: color.text }}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/** A pulsing placeholder the size of the content it stands in for. */
export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | `${number}%` }) {
  const theme = useMobileTheme()
  const pulse = useRef(new Animated.Value(0.4)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])
  return (
    <Animated.View
      accessibilityElementsHidden
      style={{
        height,
        width,
        opacity: pulse,
        borderRadius: theme.radius,
        backgroundColor: theme.colors.divider,
      }}
    />
  )
}

/** A bottom sheet over the screen, for pickers and short forms. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  const theme = useMobileTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close"
        style={[styles.scrim, { backgroundColor: theme.colors.grey['900'] }]}
        onPress={onClose}
      />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.colors.background.paper,
            borderTopLeftRadius: theme.radius * 2,
            borderTopRightRadius: theme.radius * 2,
            paddingBottom: insets.bottom + theme.space(1),
          },
        ]}
      >
        <View style={[styles.cardHeader, { padding: theme.space(2) }]}>
          <Text variant="heading" style={styles.flex}>
            {title}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}>
            <Icon name="close" />
          </Pressable>
        </View>
        <ScrollView>{children}</ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  card: { borderWidth: StyleSheet.hairlineWidth },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 44, borderWidth: 1 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  scrim: { flex: 1, opacity: 0.4 },
  sheet: { maxHeight: '80%' },
})
