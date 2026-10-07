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
 * Sign in to Aglyn POS with the same account the console uses (AGL-3618),
 * the Aglyn app's sign-in (AGL-3620) with the till's words. A staff member
 * needs a site role that may sell and the Point of sale permission; the
 * routes refuse anyone else, exactly as the console does.
 */

import { mobileBrandName, signInErrorMessage, useMobileAuth } from '@aglyn/mobile-core'
import { Button, Text, TextField, useLayout, useMobileTheme } from '@aglyn/mobile-ui'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export function SignInScreen() {
  const { signIn, resetPassword } = useMobileAuth()
  const theme = useMobileTheme()
  const { kind } = useLayout()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await signIn(email, password)
    } catch (caught) {
      setError(signInErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function forgot() {
    setError(null)
    if (!email.trim()) {
      setError('Enter your email first, then tap Forgot password.')
      return
    }
    try {
      await resetPassword(email)
      setNotice(`If that email has an ${mobileBrandName()} account, a reset link is on its way.`)
    } catch (caught) {
      setError(signInErrorMessage(caught))
    }
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.colors.background.default }]}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.center, { padding: theme.space(3) }]} keyboardShouldPersistTaps="handled">
          <View style={{ width: '100%', maxWidth: kind === 'tablet' ? 420 : undefined, gap: theme.space(2) }}>
            <Text variant="title">{mobileBrandName()} POS</Text>
            <Text tone="secondary">Sign in with your account to ring up sales and take cards.</Text>
            <TextField
              label="Email"
              testID="sign-in-email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
            />
            <TextField
              label="Password"
              testID="sign-in-password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              onSubmitEditing={submit}
              error={error}
            />
            {notice ? <Text tone="secondary">{notice}</Text> : null}
            <Button title="Sign in" testID="sign-in-submit" busy={busy} disabled={!email || !password} onPress={submit} />
            <Button title="Forgot password" variant="text" onPress={forgot} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
})
