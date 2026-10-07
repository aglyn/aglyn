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
import { mintConsoleSession, consoleSitePageUrl } from '@aglyn/mobile-core'
import { Button, Label, Loading, Notice, Screen, useLayout, useMobileTheme } from '@aglyn/mobile-ui'
import { ConsoleWebView, type ConsoleWebViewHandle } from '@aglyn/mobile-webview'
import type { User } from 'firebase/auth'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { createPosBridgeHandlers, POS_BRIDGE_NAME } from '../bridge/pos-bridge'
import type { PosSelection } from '../selection'
import { api, config, trustedOrigins } from '../services'
import { setTerminalHost } from '../terminal/context'
import { usePosTerminal } from '../terminal/use-pos-terminal'
import { LAST_READER_KIND_KEY, ReadersPanel } from './readers-panel'
import { TapToPayEducationScreen } from './tap-to-pay-education-screen'

type SessionState = { phase: 'minting' } | { phase: 'ready' } | { phase: 'error'; message: string }

/**
 * The register (AGL-3618): the console's own POS page in a WebView, signed
 * in with this app's session, plus the card readers only the app can drive.
 * On a tablet the readers sit beside the register; on a phone they open as a
 * sheet.
 */
export function RegisterScreen(props: {
  user: User
  selection: PosSelection
  onSwitchStore: () => void
  onSignOut: () => void
}) {
  const theme = useMobileTheme()
  const layout = useLayout()
  const { site, register } = props.selection
  setTerminalHost(site.hostId)
  const terminal = usePosTerminal({ api, hostId: site.hostId })
  const [session, setSession] = useState<SessionState>({ phase: 'minting' })
  const [readersOpen, setReadersOpen] = useState(false)
  const [education, setEducation] = useState(false)
  const webview = useRef<ConsoleWebViewHandle>(null)
  const reminted = useRef(false)

  const mint = useCallback(async () => {
    setSession({ phase: 'minting' })
    const idToken = await props.user.getIdToken(true).catch(() => null)
    if (!idToken) {
      setSession({ phase: 'error', message: 'Your session ended. Sign in again.' })
      return
    }
    const result = await mintConsoleSession({ origin: config.consoleOrigin, idToken })
    setSession(result.ok ? { phase: 'ready' } : { phase: 'error', message: result.error })
  }, [props.user])

  useEffect(() => {
    void mint()
  }, [mint])

  // Pre-warm the reader the merchant used last, as Stripe and Apple advise:
  // connecting at the first sale makes the customer wait.
  useEffect(() => {
    if (!terminal.context || terminal.status.connected) return
    void AsyncStorage.getItem(LAST_READER_KIND_KEY).then((kind) => {
      if (kind === 'tapToPay') void terminal.discover('tapToPay', terminal.context?.testMode ?? false)
    })
    // Once the site's terminal context arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal.context])

  const statusRef = useRef(terminal.status)
  statusRef.current = terminal.status
  const handlers = useMemo(
    () =>
      createPosBridgeHandlers({
        collect: terminal.collect,
        cancel: terminal.cancel,
        status: () => statusRef.current,
        onNeedsReader: () => setReadersOpen(true),
      }),
    [terminal.collect, terminal.cancel],
  )

  const url = useMemo(
    () => consoleSitePageUrl(config.consoleOrigin, site, 'pos', register ? { register: register.id } : undefined),
    [register, site],
  )

  const readers = (
    <ReadersPanel
      terminal={terminal}
      onShowFallbackEducation={() => setEducation(true)}
      onClose={layout.split ? undefined : () => setReadersOpen(false)}
    />
  )

  const chipLabel = terminal.status.connected
    ? terminal.status.name ?? 'Reader connected'
    : terminal.status.connection === 'connecting' || terminal.status.connection === 'reconnecting'
      ? 'Connecting reader…'
      : 'Connect a reader'

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.palette.background.paper }} edges={['top', 'left', 'right']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing(1),
          paddingHorizontal: theme.spacing(1.5),
          minHeight: theme.touchTarget + theme.spacing(1),
          borderBottomWidth: 1,
          borderBottomColor: theme.palette.divider,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Switch store. Now ${site.name}${register ? `, ${register.name}` : ''}`}
          onPress={props.onSwitchStore}
          style={{ flex: 1, minHeight: theme.touchTarget, justifyContent: 'center' }}
          testID="register-switch-store"
        >
          <Label bold>{site.name}</Label>
          {register ? <Label variant="caption" tone="secondary">{register.name}</Label> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Card readers: ${chipLabel}`}
          onPress={() => setReadersOpen((open) => !open)}
          testID="reader-chip"
          style={{
            minHeight: theme.touchTarget,
            justifyContent: 'center',
            paddingHorizontal: theme.spacing(1.5),
            borderRadius: theme.radius.pill,
            backgroundColor: terminal.status.connected ? theme.palette.success.main : theme.palette.tint.primary,
          }}
        >
          <Label variant="caption" bold>
            {chipLabel}
          </Label>
        </Pressable>
        <Button label="Sign out" variant="text" onPress={props.onSignOut} />
      </View>

      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ flex: 1 }}>
          {session.phase === 'minting' ? <Loading label="Opening the register" /> : null}
          {session.phase === 'error' ? (
            <Screen>
              <Notice tone="error" message={session.message} action={{ label: 'Retry', onPress: () => void mint() }} />
            </Screen>
          ) : null}
          {session.phase === 'ready' ? (
            <ConsoleWebView
              ref={webview}
              testID="register-webview"
              url={url}
              trustedOrigins={trustedOrigins}
              bridgeName={POS_BRIDGE_NAME}
              handlers={handlers}
              bridgeInfo={{ platform: Platform.OS, app: 'aglyn-pos', version: 1 }}
              onSignedOut={() => {
                // The cookie expired or was revoked. Re-mint once from the
                // live Firebase session; a second bounce is a real sign-out.
                if (reminted.current) {
                  props.onSignOut()
                  return
                }
                reminted.current = true
                void mint()
              }}
              onLoadError={(message) => setSession({ phase: 'error', message })}
            />
          ) : null}
        </View>
        {layout.split && readersOpen ? (
          <ScrollView
            style={{ width: 380, flexGrow: 0, borderLeftWidth: 1, borderLeftColor: theme.palette.divider, backgroundColor: theme.palette.background.default }}
            contentContainerStyle={{ padding: theme.spacing(2) }}
          >
            {readers}
          </ScrollView>
        ) : null}
      </View>

      <Modal
        visible={!layout.split && readersOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setReadersOpen(false)}
      >
        <Screen>{readers}</Screen>
      </Modal>
      <Modal visible={education} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEducation(false)}>
        <TapToPayEducationScreen onDone={() => setEducation(false)} />
      </Modal>
    </SafeAreaView>
  )
}
