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
  AuthProvider,
  createConsoleApiClient,
  getMobileFirebase,
  MobileQueryProvider,
  useMobileAuth,
  WorkspaceProvider,
} from '@aglyn/mobile-core'
import { loadMobilePlugins } from '@aglyn/mobile-plugin-host'
import { EmptyState, MobileThemeProvider, useMobileTheme } from '@aglyn/mobile-ui'
import { StripeTerminalProvider } from '@stripe/stripe-terminal-react-native'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { useEffect, useMemo, type ReactNode } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { APP_VERSION, config, configProblems } from './src/config'
import { MOBILE_PLUGIN_MANIFEST } from './src/plugins.mobile.generated'
import { SignInScreen } from './src/screens/sign-in'
import { PosShell } from './src/shell/pos-shell'
import { createTokenProvider } from './src/terminal/context'

/**
 * Aglyn POS (AGL-3618): sign in, choose the store, sell. The shell is
 * generic; the register and the counter bookings are the commerce and
 * bookings plugins' Aglyn POS contributions, loaded from the generated
 * manifest.
 */
const pluginsLoaded = configProblems.length
  ? Promise.resolve(null)
  : loadMobilePlugins(MOBILE_PLUGIN_MANIFEST).then((result) => {
      if (__DEV__ && result.failed.length) console.warn('[aglyn-pos] plugins that did not load:', result.failed)
      return result
    })

function Themed({ children }: { children: ReactNode }) {
  const theme = useMobileTheme()
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.background.default).catch(() => undefined)
  }, [theme])
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </>
  )
}

function Gate() {
  const { user, ready } = useMobileAuth()
  const theme = useMobileTheme()
  useEffect(() => {
    void pluginsLoaded
  }, [])
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background.default }}>
        <ActivityIndicator color={theme.colors.primary.main} />
      </View>
    )
  }
  if (!user) return <SignInScreen />
  return (
    <MobileQueryProvider uid={user.uid} buster={APP_VERSION}>
      <WorkspaceProvider>
        <PosShell />
      </WorkspaceProvider>
    </MobileQueryProvider>
  )
}

function Configured() {
  // The SDK asks the card-reader backend for a token for the store this
  // device sells for; the shell sets which store that is.
  const tokenProvider = useMemo(() => {
    const { auth } = getMobileFirebase()
    return createTokenProvider(
      createConsoleApiClient({
        origin: config.consoleOrigin,
        getIdToken: async (forceRefresh) => (auth.currentUser ? auth.currentUser.getIdToken(forceRefresh) : null),
      }),
    )
  }, [])
  return (
    <StripeTerminalProvider tokenProvider={tokenProvider} logLevel={__DEV__ ? 'verbose' : 'none'}>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </StripeTerminalProvider>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MobileThemeProvider>
        <Themed>
          {configProblems.length ? (
            <EmptyState icon="construct-outline" title="This build is not configured" body={configProblems.join('\n')} />
          ) : (
            <Configured />
          )}
        </Themed>
      </MobileThemeProvider>
    </SafeAreaProvider>
  )
}
