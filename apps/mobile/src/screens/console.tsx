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
 * Any console path, in the authenticated console WebView (AGL-3620). The
 * Besigner opens here; so does every screen no plugin draws natively. A
 * console page may ask the app to open a path natively (`openNative`) or to
 * close the WebView (`close`); those two are the whole bridge.
 */

import { getMobileConfig } from '@aglyn/mobile-core'
import { getMobileDeepLinks, resolveMobileLink } from '@aglyn/mobile-plugin-host'
import { useMobileTheme } from '@aglyn/mobile-ui'
import { ConsoleWebView } from '@aglyn/mobile-webview'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { useConsoleSession } from '../shell/session-handoff'
import type { RootStackParams } from '../shell/navigation-ref'

/** The console URL for a path; anything that would leave the origin opens the console's home. */
export function consoleUrlFor(origin: string, path: string): string {
  const safe = path.startsWith('/') && !path.startsWith('//') ? path : '/'
  return `${origin}${safe}`
}

export function ConsoleScreen({ route }: { route: { params: RootStackParams['Console'] } }) {
  const theme = useMobileTheme()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>()
  const ensureSession = useConsoleSession()
  const [ready, setReady] = useState(false)
  const origin = getMobileConfig().consoleOrigin
  const trusted = useMemo(() => [origin], [origin])

  useEffect(() => {
    let active = true
    ensureSession()
      .catch(() => undefined)
      .finally(() => active && setReady(true))
    return () => {
      active = false
    }
  }, [ensureSession])

  const handlers = useMemo(
    () => ({
      openNative: async (params: Record<string, unknown>) => {
        const path = typeof params['path'] === 'string' ? params['path'] : ''
        const target = resolveMobileLink(path, getMobileDeepLinks())
        if (target?.kind !== 'screen') return { opened: false }
        navigation.navigate('PluginScreen', { screenId: target.screen, params: target.params })
        return { opened: true }
      },
      close: async () => {
        navigation.goBack()
        return null
      },
    }),
    [navigation],
  )

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background.default }}>
        <ActivityIndicator color={theme.colors.primary.main} />
      </View>
    )
  }

  return (
    <ConsoleWebView
      testID="console-webview"
      url={consoleUrlFor(origin, route.params.path)}
      trustedOrigins={trusted}
      bridgeName="AglynApp"
      handlers={handlers}
      bridgeInfo={{ app: 'aglyn' }}
      onTitleChange={(title) => navigation.setOptions({ title })}
      backgroundColor={theme.colors.background.default}
    />
  )
}
