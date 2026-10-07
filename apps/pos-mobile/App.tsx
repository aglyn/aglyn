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

import AsyncStorage from '@react-native-async-storage/async-storage'
import { endConsoleSession, signOutEverywhere, useFirebaseUser } from '@aglyn/mobile-core'
import { Loading, MobileThemeProvider } from '@aglyn/mobile-ui'
import { StripeTerminalProvider } from '@stripe/stripe-terminal-react-native'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useMemo, useState } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { SELECTION_KEY, type PosSelection } from './src/selection'
import { RegisterScreen } from './src/screens/register-screen'
import { SignInScreen } from './src/screens/sign-in-screen'
import { SitePickerScreen } from './src/screens/site-picker-screen'
import { api, config, firebase } from './src/services'
import { createTokenProvider, setTerminalHost } from './src/terminal/context'

/** Aglyn POS (AGL-3618): sign in, choose the store and register, sell. */
export default function App() {
  const tokenProvider = useMemo(() => createTokenProvider(api), [])
  return (
    <SafeAreaProvider>
      <MobileThemeProvider>
        <StatusBar style="auto" />
        <StripeTerminalProvider tokenProvider={tokenProvider} logLevel={__DEV__ ? 'verbose' : 'none'}>
          <Root />
        </StripeTerminalProvider>
      </MobileThemeProvider>
    </SafeAreaProvider>
  )
}

function Root() {
  if (!firebase) return <SignInScreen />
  return <SignedInRoot />
}

function SignedInRoot() {
  const auth = firebase!.auth
  const user = useFirebaseUser(auth)
  const [selection, setSelection] = useState<PosSelection | null>(null)

  const signOut = useCallback(async () => {
    setSelection(null)
    setTerminalHost(null)
    await AsyncStorage.removeItem(SELECTION_KEY).catch(() => undefined)
    await signOutEverywhere(auth, () => endConsoleSession({ origin: config.consoleOrigin }))
  }, [auth])

  const switchStore = useCallback(async () => {
    await AsyncStorage.removeItem(SELECTION_KEY).catch(() => undefined)
    setSelection(null)
  }, [])

  if (user === undefined) return <Loading label="Starting Aglyn POS" />
  if (!user) return <SignInScreen />
  if (!selection) {
    return <SitePickerScreen user={user} onChoose={setSelection} onSignOut={() => void signOut()} />
  }
  return (
    <RegisterScreen
      key={`${selection.site.hostId}:${selection.register?.id ?? ''}`}
      user={user}
      selection={selection}
      onSwitchStore={() => void switchStore()}
      onSignOut={() => void signOut()}
    />
  )
}
