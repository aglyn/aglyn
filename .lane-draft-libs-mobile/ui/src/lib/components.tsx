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

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { layoutFor, type MobileLayout } from './layout'
import { darkTheme, lightTheme, type MobileTheme } from './theme'

/*==========================================
 * BASIC MOBILE COMPONENTS (AGL-3618).
 *
 * The native counterpart of "MUI basic elements only": a small set of plain
 * components drawn entirely from the theme tokens, so both apps look like the
 * console without importing it. Every pressable is at least the theme's
 * touch target and carries an accessibility role and label.
 *=========================================*/

const ThemeContext = createContext<MobileTheme>(lightTheme)

export function MobileThemeProvider(props: { children: ReactNode; mode?: 'light' | 'dark' }) {
  const system = useColorScheme()
  const theme = (props.mode ?? system) === 'dark' ? darkTheme : lightTheme
  return <ThemeContext.Provider value={theme}>{props.children}</ThemeContext.Provider>
}

export function useMobileTheme(): MobileTheme {
  return useContext(ThemeContext)
}

/** Phone or tablet, recomputed on rotation and split-screen resizes. */
export function useLayout(): MobileLayout {
  const { width, height } = useWindowDimensions()
  return useMemo(() => layoutFor(width, height), [width, height])
}

export function Screen(props: { children: ReactNode; scroll?: boolean; testID?: string }) {
  const theme = useMobileTheme()
  const layout = useLayout()
  const body = (
    <View
      style={{
        flexGrow: 1,
        padding: theme.spacing(layout.formFactor === 'tablet' ? 4 : 2),
        width: '100%',
        // Forms and lists stay a readable width on a tablet.
        maxWidth: layout.formFactor === 'tablet' ? 720 : undefined,
        alignSelf: 'center',
      }}
    >
      {props.children}
    </View>
  )
  return (
    <SafeAreaView
      testID={props.testID}
      style={{ flex: 1, backgroundColor: theme.palette.background.default }}
    >
      {props.scroll === false ? body : (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

type TextVariant = 'display' | 'headline' | 'title' | 'subtitle' | 'body' | 'caption'

export function Label(props: {
  children: ReactNode
  variant?: TextVariant
  tone?: 'primary' | 'secondary' | 'error' | 'link'
  bold?: boolean
  center?: boolean
  testID?: string
}) {
  const theme = useMobileTheme()
  const variant = props.variant ?? 'body'
  const color =
    props.tone === 'secondary'
      ? theme.palette.text.secondary
      : props.tone === 'error'
        ? theme.palette.error.main
        : props.tone === 'link'
          ? theme.palette.primary.dark
          : theme.palette.text.primary
  return (
    <Text
      testID={props.testID}
      accessibilityRole={variant === 'display' || variant === 'headline' ? 'header' : 'text'}
      style={{
        color,
        fontSize: theme.type[variant],
        fontWeight:
          props.bold || variant === 'display' || variant === 'headline' || variant === 'title'
            ? theme.weight.bold
            : theme.weight.regular,
        textAlign: props.center ? 'center' : 'auto',
      }}
    >
      {props.children}
    </Text>
  )
}

export function Button(props: {
  label: string
  onPress: () => void
  variant?: 'contained' | 'outlined' | 'text'
  busy?: boolean
  disabled?: boolean
  accessibilityHint?: string
  testID?: string
  icon?: ReactNode
}) {
  const theme = useMobileTheme()
  const variant = props.variant ?? 'contained'
  const inactive = Boolean(props.disabled || props.busy)
  const fill = variant === 'contained' ? theme.palette.primary.main : 'transparent'
  const ink = variant === 'contained' ? theme.palette.primary.contrastText : theme.palette.primary.dark
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityHint={props.accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: Boolean(props.busy) }}
      disabled={inactive}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: theme.touchTarget,
        paddingHorizontal: theme.spacing(2),
        borderRadius: theme.radius.control,
        backgroundColor: fill,
        borderWidth: variant === 'outlined' ? StyleSheet.hairlineWidth * 2 : 0,
        borderColor: theme.palette.primary.main,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: theme.spacing(1),
        opacity: inactive ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {props.busy ? <ActivityIndicator color={ink} /> : props.icon}
      <Text style={{ color: ink, fontSize: theme.type.body, fontWeight: theme.weight.medium }}>
        {props.label}
      </Text>
    </Pressable>
  )
}

export function TextField(props: TextInputProps & { label: string; error?: string | null }) {
  const theme = useMobileTheme()
  const { label, error, style, ...input } = props
  return (
    <View style={{ gap: theme.spacing(0.5) }}>
      <Text style={{ color: theme.palette.text.secondary, fontSize: theme.type.caption }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.palette.text.disabled}
        {...input}
        style={[
          {
            minHeight: theme.touchTarget,
            borderRadius: theme.radius.control,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: error ? theme.palette.error.main : theme.palette.inputOutline,
            paddingHorizontal: theme.spacing(1.5),
            color: theme.palette.text.primary,
            backgroundColor: theme.palette.background.paper,
            fontSize: theme.type.body,
          },
          style,
        ]}
      />
      {error ? (
        <Text style={{ color: theme.palette.error.main, fontSize: theme.type.caption }}>{error}</Text>
      ) : null}
    </View>
  )
}

export function Card(props: { children: ReactNode; style?: ViewStyle; testID?: string }) {
  const theme = useMobileTheme()
  return (
    <View
      testID={props.testID}
      style={[
        {
          backgroundColor: theme.palette.background.paper,
          borderRadius: theme.radius.surface,
          padding: theme.spacing(2),
          gap: theme.spacing(1.5),
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.palette.divider,
        },
        props.style,
      ]}
    >
      {props.children}
    </View>
  )
}

export function ListRow(props: {
  title: string
  subtitle?: string
  selected?: boolean
  onPress?: () => void
  trailing?: ReactNode
  testID?: string
}) {
  const theme = useMobileTheme()
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole={props.onPress ? 'button' : undefined}
      accessibilityLabel={props.subtitle ? `${props.title}, ${props.subtitle}` : props.title}
      accessibilityState={{ selected: Boolean(props.selected) }}
      disabled={!props.onPress}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: theme.touchTarget + theme.spacing(1),
        paddingVertical: theme.spacing(1),
        paddingHorizontal: theme.spacing(2),
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing(1.5),
        borderRadius: theme.radius.control,
        backgroundColor: props.selected
          ? theme.palette.tint.primary
          : pressed
            ? theme.palette.tint.tertiary
            : 'transparent',
      })}
    >
      <View style={{ flex: 1, gap: theme.spacing(0.25) }}>
        <Text style={{ color: theme.palette.text.primary, fontSize: theme.type.body, fontWeight: theme.weight.medium }}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text style={{ color: theme.palette.text.secondary, fontSize: theme.type.caption }}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.trailing}
    </Pressable>
  )
}

export function Notice(props: {
  tone: 'info' | 'error' | 'success' | 'warning'
  message: string
  action?: { label: string; onPress: () => void }
  testID?: string
}) {
  const theme = useMobileTheme()
  const color = theme.palette[props.tone]
  return (
    <View
      testID={props.testID}
      accessibilityRole={props.tone === 'error' ? 'alert' : 'summary'}
      style={{
        backgroundColor: color.main,
        borderRadius: theme.radius.control,
        padding: theme.spacing(1.5),
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing(1),
      }}
    >
      <Text style={{ flex: 1, color: color.contrastText, fontSize: theme.type.body }}>{props.message}</Text>
      {props.action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.action.label}
          onPress={props.action.onPress}
          style={{ minHeight: theme.touchTarget, justifyContent: 'center', paddingHorizontal: theme.spacing(1) }}
        >
          <Text style={{ color: color.contrastText, fontWeight: theme.weight.bold, fontSize: theme.type.body }}>
            {props.action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export function EmptyState(props: { title: string; body?: string; action?: ReactNode; testID?: string }) {
  const theme = useMobileTheme()
  return (
    <View
      testID={props.testID}
      style={{ alignItems: 'center', justifyContent: 'center', padding: theme.spacing(4), gap: theme.spacing(1.5) }}
    >
      <Label variant="title" center>
        {props.title}
      </Label>
      {props.body ? (
        <Label tone="secondary" center>
          {props.body}
        </Label>
      ) : null}
      {props.action}
    </View>
  )
}

export function Loading(props: { label?: string }) {
  const theme = useMobileTheme()
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={props.label ?? 'Loading'}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing(1.5) }}
    >
      <ActivityIndicator color={theme.palette.primary.main} size="large" />
      {props.label ? <Label tone="secondary">{props.label}</Label> : null}
    </View>
  )
}
