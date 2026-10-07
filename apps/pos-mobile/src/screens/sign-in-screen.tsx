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

import {
  requestPasswordReset,
  signInErrorMessage,
  signInWithEmail,
  signInWithGoogleIdToken,
} from '@aglyn/mobile-core'
import { Button, Card, Label, Notice, Screen, TextField, useMobileTheme } from '@aglyn/mobile-ui'
import * as Google from 'expo-auth-session/providers/google'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { config, configProblems, firebase } from '../services'

WebBrowser.maybeCompleteAuthSession()

/**
 * Sign in with the Aglyn console account (AGL-3618): email and password, and
 * Google when its OAuth client ids are configured for this build. The same
 * Firebase accounts as the console, so there is nothing to sign up for here.
 */
export function SignInScreen() {
  const theme = useMobileTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (!firebase) {
    return (
      <Screen testID="sign-in-misconfigured">
        <Label variant="headline">Aglyn POS</Label>
        <Notice tone="error" message={`This build is not configured: ${configProblems.join(' ')}`} />
      </Screen>
    )
  }
  const auth = firebase.auth

  async function submit() {
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await signInWithEmail(auth, email, password)
    } catch (caught) {
      setError(signInErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (!email.trim()) {
      setError('Enter your email, then choose "Forgot password".')
      return
    }
    try {
      await requestPasswordReset(auth, email)
    } catch {
      // Same answer either way: never reveal whether an account exists.
    }
    setError(null)
    setNotice('If that email has an Aglyn account, a reset link is on its way.')
  }

  return (
    <Screen testID="sign-in-screen">
      <View style={{ gap: theme.spacing(3), paddingTop: theme.spacing(4) }}>
        <View style={{ gap: theme.spacing(1) }}>
          <Label variant="display">Aglyn POS</Label>
          <Label tone="secondary">
            Sign in with your Aglyn account to open your store’s register and take card payments on this
            device.
          </Label>
        </View>
        <Card>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            testID="sign-in-email"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            onSubmitEditing={submit}
            testID="sign-in-password"
          />
          {error ? <Notice tone="error" message={error} testID="sign-in-error" /> : null}
          {notice ? <Notice tone="info" message={notice} /> : null}
          <Button label="Sign in" onPress={submit} busy={busy} testID="sign-in-submit" />
          <Button label="Forgot password" variant="text" onPress={reset} />
        </Card>
        {config.google ? <GoogleSignIn onError={setError} /> : null}
      </View>
    </Screen>
  )
}

function GoogleSignIn(props: { onError: (message: string) => void }) {
  const google = config.google
  const [request, response, prompt] = Google.useIdTokenAuthRequest({
    iosClientId: google?.iosClientId,
    webClientId: google?.webClientId,
    androidClientId: google?.webClientId,
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (response?.type !== 'success' || !firebase) return
    const idToken = response.params['id_token']
    if (!idToken) {
      props.onError('Google did not return a sign-in. Try again.')
      return
    }
    setBusy(true)
    signInWithGoogleIdToken(firebase.auth, idToken)
      .catch((caught) => props.onError(signInErrorMessage(caught)))
      .finally(() => setBusy(false))
    // `props.onError` is a state setter and stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response])

  return (
    <Button
      label="Continue with Google"
      variant="outlined"
      busy={busy}
      disabled={!request}
      onPress={() => void prompt()}
      testID="sign-in-google"
    />
  )
}
