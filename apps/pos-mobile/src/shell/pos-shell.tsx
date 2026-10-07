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
import NetInfo from '@react-native-community/netinfo'
import {
  createConsoleApiClient,
  getMobileConfig,
  getMobileFirebase,
  mobileBrandName,
  useMobileAuth,
  useWorkspace,
} from '@aglyn/mobile-core'
import {
  getMobileScreen,
  type MobileParams,
  type MobilePluginContext,
  MobilePluginContextReact,
  useMobileContributions,
} from '@aglyn/mobile-plugin-host'
import { Button, Card, EmptyState, Icon, ListRow, Screen, Text, useLayout, useMobileTheme } from '@aglyn/mobile-ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { APP_VERSION } from '../config'
import { ConsoleScreen } from '../screens/console-screen'
import { ReadersPanel } from '../screens/readers-panel'
import { sitesThatCanSell, StorePicker } from '../screens/store-picker'
import { TapToPayEducationScreen } from '../screens/tap-to-pay-education-screen'
import { setTerminalHost } from '../terminal/context'
import { usePosTerminal } from '../terminal/use-pos-terminal'
import { cardReaderFor } from './card-reader'
import { LazyContribution } from './lazy-contribution'
import { useScanner } from './scanner'

/*==========================================
 * THE AGLYN POS SHELL (AGL-3618).
 *
 * Generic, like the Aglyn app's: it owns sign-in, the store, the device's
 * hardware (the card reader, the camera scanner, the network state) and
 * the console WebView, and draws the tabs plugins register for Aglyn POS
 * (`mobile.pos` in plugins.config.json): the register, the day's bookings.
 * It never names a plugin; a plugin's screen reaches the hardware only
 * through its context.
 *
 * Phone: the tabs along the bottom. Tablet: a rail down the side, so the
 * register keeps the width for its grid and the sale.
 *=========================================*/

/** A console path under the picked site's prefix, or the console's home without one. */
export function scopedConsolePath(
  path: string,
  scope: 'site' | 'org' | 'absolute',
  orgSlug: string | null,
  hostSlug: string | null,
): string {
  const rest = path.startsWith('/') ? path : `/${path}`
  if (scope === 'absolute') return rest
  if (!orgSlug) return '/'
  if (scope === 'org') return `/${orgSlug}${rest === '/' ? '' : rest}`
  if (!hostSlug) return `/${orgSlug}/hosts`
  return `/${orgSlug}/hosts/${hostSlug}${rest === '/' ? '' : rest}`
}

const MORE_TAB = '__more'
const storeKey = (uid: string) => `aglyn.pos.store.${uid}`

function useOnline(): boolean {
  const [online, setOnline] = useState(true)
  useEffect(
    () => NetInfo.addEventListener((state) => setOnline(state.isConnected !== false && state.isInternetReachable !== false)),
    [],
  )
  return online
}

export function PosShell() {
  const { user, signOut } = useMobileAuth()
  const workspace = useWorkspace()
  const uid = user?.uid ?? ''
  const [confirmed, setConfirmed] = useState<string | null | undefined>(undefined)

  // The store this device was set to sell for, so a restart opens the till.
  useEffect(() => {
    if (!uid) return
    AsyncStorage.getItem(storeKey(uid))
      .then((value) => setConfirmed(value))
      .catch(() => setConfirmed(null))
  }, [uid])

  const site = workspace.site
  const sellable = site ? sitesThatCanSell([site]).length > 0 : false
  const choose = useCallback(() => {
    if (!uid || !workspace.site) return
    setConfirmed(workspace.site.id)
    AsyncStorage.setItem(storeKey(uid), workspace.site.id).catch(() => undefined)
  }, [uid, workspace.site])

  if (confirmed === undefined || !workspace.ready) return <EmptyState icon="hourglass-outline" title="Opening the register" />
  if (!site || !sellable || confirmed !== site.id) {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <StorePicker onChosen={choose} onSignOut={() => void signOut()} />
      </SafeAreaView>
    )
  }
  return (
    <Till
      key={site.id}
      onSwitchStore={() => {
        setConfirmed(null)
        AsyncStorage.removeItem(storeKey(uid)).catch(() => undefined)
      }}
    />
  )
}

function Till(props: { onSwitchStore: () => void }) {
  const theme = useMobileTheme()
  const layout = useLayout()
  const { user, signOut } = useMobileAuth()
  const { org, site } = useWorkspace()
  const { firestore, auth } = getMobileFirebase()
  const online = useOnline()
  const scanner = useScanner()
  const api = useMemo(
    () =>
      createConsoleApiClient({
        origin: getMobileConfig().consoleOrigin,
        getIdToken: async (forceRefresh) => (auth.currentUser ? auth.currentUser.getIdToken(forceRefresh) : null),
      }),
    [auth],
  )
  const hostId = site?.id ?? null
  setTerminalHost(hostId)
  const terminal = usePosTerminal({ api, hostId })
  const [readersOpen, setReadersOpen] = useState(false)
  const [education, setEducation] = useState(false)
  const [consolePath, setConsolePath] = useState<string | null>(null)
  const [pushed, setPushed] = useState<{ screenId: string; params: MobileParams } | null>(null)
  const { tabs } = useMobileContributions()
  const [tab, setTab] = useState<string | null>(null)
  const activeTab = tab ?? tabs[0]?.id ?? MORE_TAB

  const manageReaders = useCallback(() => setReadersOpen(true), [])
  const { status, context: session, message, collect, cancel } = terminal
  const cardReader = useMemo(
    () => cardReaderFor({ status, context: session, message, collect, cancel }, manageReaders),
    [status, session, message, collect, cancel, manageReaders],
  )

  const context = useMemo<MobilePluginContext | null>(
    () =>
      user
        ? {
            uid: user.uid,
            orgId: org?.id ?? null,
            hostId,
            orgSlug: org?.slug ?? null,
            hostSlug: site?.subdomain || null,
            firestore,
            api,
            navigate: (screenId, params = {}) => setPushed({ screenId, params }),
            openConsolePath: (path, scope = 'absolute') =>
              setConsolePath(scopedConsolePath(path, scope, org?.slug ?? null, site?.subdomain || null)),
            cardReader,
            scanCode: scanner.scanCode,
            online,
          }
        : null,
    [user, org?.id, org?.slug, hostId, site?.subdomain, firestore, api, cardReader, scanner.scanCode, online],
  )
  if (!context) return null

  const tabScreen = (screenId: string) => {
    const screen = getMobileScreen(screenId)
    if (!screen) return <EmptyState icon="warning-outline" title="This screen is not available" />
    return <LazyContribution id={screen.id} load={screen.load} props={{ params: {}, context }} />
  }
  const items = [
    ...tabs.map((entry) => ({ id: entry.id, title: entry.title, icon: entry.icon, screen: entry.screen })),
    { id: MORE_TAB, title: 'More', icon: 'ellipsis-horizontal', screen: '' },
  ]
  const current = items.find((entry) => entry.id === activeTab) ?? items[0]
  const body =
    current.id === MORE_TAB ? (
      <MoreScreen
        storeName={site?.name ?? ''}
        readerLabel={terminal.status.connected ? terminal.status.name ?? 'Connected' : 'Not connected'}
        testMode={terminal.context?.testMode ?? false}
        onReaders={manageReaders}
        onSwitchStore={props.onSwitchStore}
        onConsole={() => context.openConsolePath('/pos', 'site')}
        onSignOut={() => void signOut()}
      />
    ) : (
      tabScreen(current.screen)
    )

  const navButton = (entry: (typeof items)[number], vertical: boolean) => {
    const selected = entry.id === current.id
    const color = selected ? theme.colors.primary.text : theme.colors.text.secondary
    return (
      <Pressable
        key={entry.id}
        testID={`tab-${entry.id}`}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        accessibilityLabel={entry.title}
        onPress={() => setTab(entry.id)}
        style={[vertical ? styles.railItem : styles.tabItem, { paddingVertical: theme.space(1) }]}
      >
        <Icon name={selected ? entry.icon.replace(/-outline$/, '') : entry.icon} color={color} size={24} />
        <Text variant="caption" style={{ color }}>
          {entry.title}
        </Text>
      </Pressable>
    )
  }

  return (
    <MobilePluginContextReact.Provider value={context}>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.colors.background.paper }}
        edges={layout.split ? ['top', 'bottom', 'left'] : ['top']}
      >
        {layout.split ? (
          <View style={styles.row}>
            <View
              style={[styles.rail, { width: 88, borderRightColor: theme.colors.divider, paddingTop: theme.space(1) }]}
              accessibilityRole="tablist"
            >
              {items.map((entry) => navButton(entry, true))}
            </View>
            <View style={{ flex: 1, backgroundColor: theme.colors.background.default }}>{body}</View>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <View style={{ flex: 1, backgroundColor: theme.colors.background.default }}>{body}</View>
            <SafeAreaView
              edges={['bottom']}
              style={[styles.tabBar, { borderTopColor: theme.colors.divider, backgroundColor: theme.colors.background.paper }]}
              accessibilityRole="tablist"
            >
              {items.map((entry) => navButton(entry, false))}
            </SafeAreaView>
          </View>
        )}
      </SafeAreaView>

      <Modal
        visible={readersOpen}
        animationType="slide"
        presentationStyle={layout.formFactor === 'tablet' ? 'formSheet' : 'pageSheet'}
        onRequestClose={() => setReadersOpen(false)}
      >
        <Screen>
          <ReadersPanel
            terminal={terminal}
            onShowFallbackEducation={() => setEducation(true)}
            onClose={() => setReadersOpen(false)}
          />
        </Screen>
        <Modal visible={education} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEducation(false)}>
          <TapToPayEducationScreen onDone={() => setEducation(false)} />
        </Modal>
      </Modal>

      <Modal visible={Boolean(consolePath)} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setConsolePath(null)}>
        {consolePath ? (
          <ConsoleScreen
            path={consolePath}
            terminal={terminal}
            onNeedsReader={manageReaders}
            onClose={() => setConsolePath(null)}
            onSignedOut={() => void signOut()}
          />
        ) : null}
      </Modal>

      <Modal visible={Boolean(pushed)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPushed(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background.default }}>
          <Button title="Back" variant="text" icon="chevron-back" onPress={() => setPushed(null)} />
          {pushed ? (
            (() => {
              const screen = getMobileScreen(pushed.screenId)
              return screen ? (
                <LazyContribution id={screen.id} load={screen.load} props={{ params: pushed.params, context }} />
              ) : (
                <EmptyState icon="warning-outline" title="This screen is not available" />
              )
            })()
          ) : null}
        </SafeAreaView>
      </Modal>
      {scanner.modal}
    </MobilePluginContextReact.Provider>
  )
}

function MoreScreen(props: {
  storeName: string
  readerLabel: string
  testMode: boolean
  onReaders: () => void
  onSwitchStore: () => void
  onConsole: () => void
  onSignOut: () => void
}) {
  return (
    <Screen>
      <Card title="This register">
        <ListRow title="Store" subtitle={props.storeName} icon="storefront-outline" onPress={props.onSwitchStore} testID="more-store" />
        <ListRow title="Card readers" subtitle={props.readerLabel} icon="card-outline" onPress={props.onReaders} testID="more-readers" />
        <ListRow
          title="Shifts, drawer and returns"
          subtitle="Open the console’s Point of sale page"
          icon="time-outline"
          onPress={props.onConsole}
        />
      </Card>
      {props.testMode ? (
        <Text tone="error">Test mode: simulated readers and test cards. Nobody is charged.</Text>
      ) : null}
      <Button title="Sign out" variant="outlined" icon="log-out-outline" onPress={props.onSignOut} testID="more-sign-out" />
      <Text variant="caption" tone="secondary">
        {mobileBrandName()} POS {APP_VERSION}
      </Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  rail: { borderRightWidth: StyleSheet.hairlineWidth, alignItems: 'stretch' },
  railItem: { alignItems: 'center', gap: 2 },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tabItem: { flex: 1, alignItems: 'center', gap: 2 },
})
