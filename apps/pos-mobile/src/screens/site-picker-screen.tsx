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
import { listWorkspaceSites, type WorkspaceSite } from '@aglyn/mobile-core'
import {
  Button,
  Card,
  EmptyState,
  Label,
  ListRow,
  Loading,
  Notice,
  Screen,
  useLayout,
  useMobileTheme,
} from '@aglyn/mobile-ui'
import type { User } from 'firebase/auth'
import { useCallback, useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  listRegisters,
  parseSelection,
  SELECTION_KEY,
  serializeSelection,
  sitesThatCanSell,
  type PosRegister,
  type PosSelection,
} from '../selection'
import { firebase } from '../services'

/**
 * Pick the store and the register (AGL-3618). On a phone, a list of stores,
 * then that store's registers; on a tablet, both side by side.
 */
export function SitePickerScreen(props: {
  user: User
  onChoose: (selection: PosSelection) => void
  onSignOut: () => void
}) {
  const theme = useMobileTheme()
  const layout = useLayout()
  const [sites, setSites] = useState<WorkspaceSite[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [site, setSite] = useState<WorkspaceSite | null>(null)
  const [registers, setRegisters] = useState<PosRegister[] | null>(null)

  const load = useCallback(async () => {
    if (!firebase) return
    setError(null)
    try {
      const all = await listWorkspaceSites(firebase.firestore, props.user.uid)
      const sellable = sitesThatCanSell(all)
      setSites(sellable)
      const saved = parseSelection(await AsyncStorage.getItem(SELECTION_KEY), props.user.uid, all)
      if (saved) props.onChoose(saved)
      else if (sellable.length === 1) setSite(sellable[0])
    } catch {
      setError('Your stores could not be loaded. Check the connection and try again.')
    }
  }, [props])

  useEffect(() => {
    void load()
    // Once per signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.user.uid])

  useEffect(() => {
    if (!site || !firebase) return
    let active = true
    setRegisters(null)
    listRegisters(firebase.firestore, site.hostId)
      .then((next) => active && setRegisters(next))
      .catch(() => active && setRegisters([]))
    return () => {
      active = false
    }
  }, [site])

  async function choose(register: PosRegister | null) {
    if (!site) return
    const selection = { site, register }
    await AsyncStorage.setItem(SELECTION_KEY, serializeSelection(selection, props.user.uid)).catch(
      () => undefined,
    )
    props.onChoose(selection)
  }

  if (error) {
    return (
      <Screen>
        <Notice tone="error" message={error} action={{ label: 'Retry', onPress: () => void load() }} />
      </Screen>
    )
  }
  if (!sites) return <Loading label="Loading your stores" />
  if (!sites.length) {
    return (
      <Screen testID="site-picker-empty">
        <EmptyState
          title="No stores to sell from"
          body="Aglyn POS opens the register for sites where you are an admin or editor. Ask your workspace owner for access, or add a site in the Aglyn console."
          action={<Button label="Sign out" variant="outlined" onPress={props.onSignOut} />}
        />
      </Screen>
    )
  }

  const siteList = (
    <View style={{ gap: theme.spacing(0.5) }}>
      <Label variant="title">Store</Label>
      {sites.map((entry) => (
        <ListRow
          key={entry.hostId}
          testID={`site-${entry.subdomain}`}
          title={entry.name}
          subtitle={entry.orgName}
          selected={site?.hostId === entry.hostId}
          onPress={() => setSite(entry)}
        />
      ))}
    </View>
  )
  const registerList = site ? (
    <View style={{ gap: theme.spacing(0.5) }}>
      <Label variant="title">Register at {site.name}</Label>
      {registers === null ? (
        <Loading />
      ) : registers.length === 0 ? (
        <Card>
          <Label tone="secondary">
            This store has no registers yet. Open the register anyway to add one there.
          </Label>
          <Button label="Open the register" onPress={() => void choose(null)} testID="register-open-none" />
        </Card>
      ) : (
        registers.map((register) => (
          <ListRow
            key={register.id}
            testID={`register-${register.id}`}
            title={register.name}
            onPress={() => void choose(register)}
          />
        ))
      )}
    </View>
  ) : (
    <Label tone="secondary">Choose a store to see its registers.</Label>
  )

  if (layout.split) {
    return (
      <SafeAreaView style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.palette.background.default }} testID="site-picker-split">
        <ScrollView
          style={{ width: 360, flexGrow: 0, borderRightWidth: 1, borderRightColor: theme.palette.divider }}
          contentContainerStyle={{ padding: theme.spacing(3), gap: theme.spacing(2) }}
        >
          <Label variant="headline">Aglyn POS</Label>
          {siteList}
          <Button label="Sign out" variant="text" onPress={props.onSignOut} />
        </ScrollView>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: theme.spacing(3) }}>
          {registerList}
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <Screen testID="site-picker">
      <View style={{ gap: theme.spacing(3) }}>
        <Label variant="headline">Aglyn POS</Label>
        {site && sites.length > 1 ? (
          <Button label={`Change store (${site.name})`} variant="text" onPress={() => setSite(null)} />
        ) : null}
        {site ? registerList : siteList}
        <Button label="Sign out" variant="text" onPress={props.onSignOut} />
      </View>
    </Screen>
  )
}
