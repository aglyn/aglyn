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
import { cardReaderAddressProblem, type MobileCardReaderAddress } from '@aglyn/mobile-plugin-host'
import { Button, Card, ListRow, Notice, Text, TextField, useMobileTheme } from '@aglyn/mobile-ui'
import { useEffect, useState } from 'react'
import { Switch, View } from 'react-native'
import { batteryLabel, readerName } from '../terminal/context'
import type { PosTerminal } from '../terminal/use-pos-terminal'
import { presentHowToTap, TAP_TO_PAY_NAME } from './tap-to-pay-education-screen'

const EDUCATED_KEY = 'aglyn-pos:tap-to-pay-educated:v1'
export const LAST_READER_KIND_KEY = 'aglyn-pos:last-reader-kind:v1'

/**
 * Card readers for the register (AGL-3618): Tap to Pay on this device, or a
 * Bluetooth reader (Stripe Reader M2, BBPOS WisePad 3). In test mode the
 * simulated readers are on by default and can be switched off to try real
 * hardware against test cards.
 *
 * Apple's rules, followed here: the Tap to Pay button is never disabled (a
 * merchant who has not set it up is led into setup, not shown a grey
 * button), the "How to Tap" education runs before the first connection and
 * stays one tap away, and connecting shows progress.
 */
export function ReadersPanel(props: {
  terminal: PosTerminal
  onShowFallbackEducation: () => void
  onClose?: () => void
}) {
  const theme = useMobileTheme()
  const { terminal } = props
  const testMode = terminal.context?.testMode ?? false
  const [simulated, setSimulated] = useState(true)
  const useSimulated = testMode && simulated
  const [settingUp, setSettingUp] = useState(false)

  // The discovered Tap to Pay reader connects at once: there is only ever one.
  useEffect(() => {
    if (!terminal.tapToPayReader || terminal.status.connected) return
    void (async () => {
      setSettingUp(true)
      try {
        if (await terminal.connect(terminal.tapToPayReader!)) {
          await AsyncStorage.setItem(LAST_READER_KIND_KEY, 'tapToPay').catch(() => undefined)
        }
      } finally {
        setSettingUp(false)
      }
    })()
    // Connect once per discovery result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal.tapToPayReader])

  async function startTapToPay() {
    const seen = await AsyncStorage.getItem(EDUCATED_KEY).catch(() => null)
    if (!seen) {
      await AsyncStorage.setItem(EDUCATED_KEY, '1').catch(() => undefined)
      if ((await presentHowToTap()) === 'fallback') {
        props.onShowFallbackEducation()
      }
    }
    setSettingUp(true)
    try {
      await terminal.discover('tapToPay', useSimulated)
    } finally {
      setSettingUp(false)
    }
  }

  async function howToTap() {
    if ((await presentHowToTap()) === 'fallback') props.onShowFallbackEducation()
  }

  const { status } = terminal
  return (
    <View style={{ gap: theme.space(2) }} testID="readers-panel">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="title">Card readers</Text>
        {props.onClose ? <Button title="Done" variant="text" onPress={props.onClose} testID="readers-close" /> : null}
      </View>

      {terminal.error ? (
        <Notice tone="error" message={terminal.error} action={{ label: 'Dismiss', onPress: terminal.clearError }} />
      ) : null}
      {terminal.message ? <Notice tone="info" message={terminal.message} /> : null}
      {terminal.setup ? <SetupCard terminal={terminal} /> : null}
      {testMode ? (
        <Notice tone="warning" message="Test mode: simulated readers and test cards. Nobody is charged." />
      ) : null}

      {status.connected ? (
        <Card>
          <Text variant="heading">
            {status.name ?? 'Card reader'}
          </Text>
          <Text tone="secondary">
            {[
              status.connection === 'reconnecting' ? 'Reconnecting' : 'Connected',
              batteryLabel(status.batteryLevel ?? undefined),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {status.updateAvailable || status.updateRequired || status.updating ? (
            <View style={{ gap: theme.space(1) }}>
              <Text>
                {status.updating
                  ? `Updating the reader: ${Math.round((status.updateProgress ?? 0) * 100)}%. Keep it on and nearby.`
                  : status.updateRequired
                    ? 'This reader needs a software update before it can take payments.'
                    : 'A reader update is available. Install it between sales; it takes a few minutes.'}
              </Text>
              {!status.updating ? (
                <Button title="Install update" onPress={() => void terminal.installUpdate()} testID="reader-update" />
              ) : null}
            </View>
          ) : null}
          <Button title="Disconnect" variant="outlined" onPress={() => void terminal.disconnect()} />
        </Card>
      ) : null}

      <Card>
        <Text variant="heading">
          {TAP_TO_PAY_NAME}
        </Text>
        <Text tone="secondary">
          Take contactless cards, phones and watches on this device, with no extra hardware.
        </Text>
        <Button
          title={status.kind === 'tapToPay' && status.connected ? `${TAP_TO_PAY_NAME} is ready` : `Use ${TAP_TO_PAY_NAME}`}
          busy={settingUp || terminal.discovering === 'tapToPay'}
          onPress={() => void startTapToPay()}
          testID="tap-to-pay-start"
        />
        <Button title="How to take a tap" variant="text" onPress={() => void howToTap()} />
      </Card>

      <Card>
        <Text variant="heading">
          Bluetooth card reader
        </Text>
        <Text tone="secondary">Stripe Reader M2 or BBPOS WisePad 3. Turn the reader on, then search.</Text>
        {terminal.discovering === 'bluetooth' ? (
          <Button title="Stop searching" variant="outlined" onPress={() => void terminal.cancelDiscovery()} />
        ) : (
          <Button
            title="Search for readers"
            variant="outlined"
            onPress={() => void terminal.discover('bluetooth', useSimulated)}
            testID="bluetooth-search"
          />
        )}
        {terminal.bluetoothReaders.map((reader) => (
          <ListRow
            key={reader.serialNumber || reader.id}
            title={readerName(reader)}
            subtitle={batteryLabel(reader.batteryLevel) ?? undefined}
            onPress={() =>
              void terminal.connect(reader).then((ok) => {
                if (ok) void AsyncStorage.setItem(LAST_READER_KIND_KEY, 'bluetooth').catch(() => undefined)
              })
            }
            testID={`bluetooth-reader-${reader.serialNumber}`}
          />
        ))}
      </Card>

      {testMode ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(1) }}>
            <View style={{ flex: 1 }}>
              <Text variant="label">Simulated readers</Text>
              <Text tone="secondary">Test mode: use Stripe’s simulated readers and test cards.</Text>
            </View>
            <Switch
              value={simulated}
              onValueChange={setSimulated}
              accessibilityLabel="Simulated readers"
              trackColor={{ true: theme.colors.primary.main, false: theme.colors.divider }}
            />
          </View>
        </Card>
      ) : null}
    </View>
  )
}

/**
 * What the store must do before a reader can connect: each setup gap the
 * card-reader backend names, with the fix the app can make (the store
 * address, which becomes the Terminal Location) or the place to make it.
 */
function SetupCard({ terminal }: { terminal: PosTerminal }) {
  const theme = useMobileTheme()
  const [address, setAddress] = useState<MobileCardReaderAddress>({
    line1: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'US',
  })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  if (terminal.setup === 'unavailable') {
    return <Notice tone="info" message="Card readers are not available for this store yet. Cash and other tenders still work." />
  }
  if (terminal.setup === 'merchant-not-ready') {
    return (
      <Notice
        tone="warning"
        message="Finish setting up payments for this store in the console, then come back to connect a reader."
        action={{ label: 'Check again', onPress: terminal.retrySetup }}
      />
    )
  }
  const field = (key: keyof MobileCardReaderAddress, label: string, extra: object = {}) => (
    <TextField
      label={label}
      value={address[key] ?? ''}
      onChangeText={(text) => setAddress((current) => ({ ...current, [key]: text }))}
      {...extra}
    />
  )
  return (
    <Card title="Where do you take payments?">
      <Text tone="secondary">
        Card networks need the address card readers are used at. It is saved once for this store.
      </Text>
      <View style={{ gap: theme.space(1) }}>
        {field('line1', 'Street address', { autoComplete: 'street-address' })}
        {field('city', 'City')}
        {field('state', 'State or region')}
        {field('postalCode', 'Postal code', { autoComplete: 'postal-code' })}
        {field('country', 'Country (two letters)', { autoCapitalize: 'characters', maxLength: 2 })}
      </View>
      {problem ? <Text tone="error">{problem}</Text> : null}
      <Button
        title="Save the store address"
        busy={busy}
        onPress={async () => {
          const found = cardReaderAddressProblem(address)
          setProblem(found)
          if (found) return
          setBusy(true)
          try {
            await terminal.registerLocation({ ...address, state: address.state || undefined })
          } finally {
            setBusy(false)
          }
        }}
      />
    </Card>
  )
}
