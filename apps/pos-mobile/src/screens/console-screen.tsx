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

import { getMobileConfig, getMobileFirebase, mintConsoleSession } from '@aglyn/mobile-core'
import { Button, Notice, Text, useMobileTheme } from '@aglyn/mobile-ui'
import { ConsoleWebView } from '@aglyn/mobile-webview'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Platform, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { createPosBridgeHandlers, POS_BRIDGE_NAME } from '../bridge/pos-bridge'
import type { PosTerminal } from '../terminal/use-pos-terminal'

/** The console URL for a path; anything that would leave the origin opens the console's home. */
export function consoleUrlFor(origin: string, path: string): string {
  const safe = path.startsWith('/') && !path.startsWith('//') ? path : '/'
  return `${origin}${safe}`
}

/**
 * A console page inside Aglyn POS (AGL-3618): the register's long tail
 * (shifts, the drawer, returns, the console register itself), signed in with
 * this app's session through the console's own `/api/auth/session`. The
 * console register finds `window.AglynPosBridge` and offers this device's
 * card reader as a tender; the bridge answers only the page on the console's
 * origin, and only its three methods.
 */
export function ConsoleScreen(props: {
  path: string
  terminal: PosTerminal
  onNeedsReader: () => void
  onClose: () => void
  onSignedOut: () => void
}) {
  const theme = useMobileTheme()
  const origin = getMobileConfig().consoleOrigin
  const trusted = useMemo(() => [origin], [origin])
  const [phase, setPhase] = useState<'minting' | 'ready' | { error: string }>('minting')
  const [title, setTitle] = useState('')
  const reminted = useRef(false)

  const mint = useCallback(async () => {
    setPhase('minting')
    const idToken = await getMobileFirebase().auth.currentUser?.getIdToken(true).catch(() => null)
    if (!idToken) {
      setPhase({ error: 'Your session ended. Sign in again.' })
      return
    }
    const result = await mintConsoleSession({ origin, idToken })
    setPhase(result.ok === false ? { error: result.error } : 'ready')
  }, [origin])

  useEffect(() => {
    void mint()
  }, [mint])

  const statusRef = useRef(props.terminal.status)
  statusRef.current = props.terminal.status
  const handlers = useMemo(
    () =>
      createPosBridgeHandlers({
        collect: props.terminal.collect,
        cancel: props.terminal.cancel,
        status: () => statusRef.current,
        onNeedsReader: props.onNeedsReader,
      }),
    [props.terminal.collect, props.terminal.cancel, props.onNeedsReader],
  )

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background.paper }} edges={['top', 'left', 'right']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space(1) }}>
        <Button title="Done" variant="text" icon="chevron-down" onPress={props.onClose} />
        <Text variant="label" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
          {title}
        </Text>
        <View style={{ width: 80 }} />
      </View>
      {phase === 'minting' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.colors.primary.main} />
        </View>
      ) : phase === 'ready' ? (
        <ConsoleWebView
          testID="console-webview"
          url={consoleUrlFor(origin, props.path)}
          trustedOrigins={trusted}
          bridgeName={POS_BRIDGE_NAME}
          handlers={handlers}
          bridgeInfo={{ platform: Platform.OS, app: 'aglyn-pos', version: 1 }}
          onTitleChange={setTitle}
          backgroundColor={theme.colors.background.default}
          onSignedOut={() => {
            // The cookie expired or was revoked. Re-mint once from the live
            // Firebase session; a second bounce is a real sign-out.
            if (reminted.current) return props.onSignedOut()
            reminted.current = true
            void mint()
          }}
          onLoadError={(message) => setPhase({ error: message })}
        />
      ) : (
        <View style={{ padding: theme.space(2) }}>
          <Notice tone="error" message={phase.error} action={{ label: 'Retry', onPress: () => void mint() }} />
        </View>
      )}
    </SafeAreaView>
  )
}
