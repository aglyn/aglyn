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
 * The Aglyn app (AGL-3620): the shell every plugin's mobile surface plugs
 * into. It holds no feature of its own beyond the dashboard, the switcher,
 * notifications and settings; everything else is a plugin's contribution or
 * the console in a WebView.
 */

import {
  AuthProvider,
  MobileQueryProvider,
  useMobileAuth,
  WorkspaceProvider,
} from '@aglyn/mobile-core'
import { loadMobilePlugins } from '@aglyn/mobile-plugin-host'
import { MobileThemeProvider, useMobileTheme } from '@aglyn/mobile-ui'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { useEffect, type ReactNode } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { APP_VERSION, configureFromEnv } from './config'
import { AppNavigation } from './navigation'
import { MOBILE_PLUGIN_MANIFEST } from './plugins.mobile.generated'
import { SignInScreen } from './screens/sign-in'
import { AppLockGate } from './shell/app-lock'
import { PluginContextProvider } from './shell/plugin-context'
import { usePushNotifications } from './shell/push'

configureFromEnv()

// Registrars are small; each plugin's screens load on first open. A plugin
// that fails is skipped (and reported in development) so the rest still load.
const pluginsLoaded = loadMobilePlugins(MOBILE_PLUGIN_MANIFEST).then((result) => {
  if (__DEV__ && result.failed.length) {
    console.warn('[aglyn] mobile plugins that did not load:', result.failed)
  }
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

function PushNotifications({ uid }: { uid: string }) {
  usePushNotifications(uid)
  return null
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
    <AppLockGate>
      <MobileQueryProvider uid={user.uid} buster={APP_VERSION}>
        <WorkspaceProvider>
          <PluginContextProvider>
            <PushNotifications uid={user.uid} />
            <AppNavigation />
          </PluginContextProvider>
        </WorkspaceProvider>
      </MobileQueryProvider>
    </AppLockGate>
  )
}

export function App() {
  return (
    <SafeAreaProvider>
      <MobileThemeProvider>
        <Themed>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </Themed>
      </MobileThemeProvider>
    </SafeAreaProvider>
  )
}
