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
import { Button, Card, Label, ListRow, Notice, useMobileTheme } from '@aglyn/mobile-ui'
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
    <View style={{ gap: theme.spacing(2) }} testID="readers-panel">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Label variant="title">Card readers</Label>
        {props.onClose ? <Button label="Done" variant="text" onPress={props.onClose} testID="readers-close" /> : null}
      </View>

      {terminal.error ? (
        <Notice tone="error" message={terminal.error} action={{ label: 'Dismiss', onPress: terminal.clearError }} />
      ) : null}
      {terminal.message ? <Notice tone="info" message={terminal.message} /> : null}

      {status.connected ? (
        <Card testID="reader-connected">
          <Label variant="subtitle" bold>
            {status.name ?? 'Card reader'}
          </Label>
          <Label tone="secondary">
            {[
              status.connection === 'reconnecting' ? 'Reconnecting' : 'Connected',
              batteryLabel(status.batteryLevel ?? undefined),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Label>
          {status.updateAvailable || status.updateRequired || status.updating ? (
            <View style={{ gap: theme.spacing(1) }}>
              <Label>
                {status.updating
                  ? `Updating the reader: ${Math.round((status.updateProgress ?? 0) * 100)}%. Keep it on and nearby.`
                  : status.updateRequired
                    ? 'This reader needs a software update before it can take payments.'
                    : 'A reader update is available. Install it between sales; it takes a few minutes.'}
              </Label>
              {!status.updating ? (
                <Button label="Install update" onPress={() => void terminal.installUpdate()} testID="reader-update" />
              ) : null}
            </View>
          ) : null}
          <Button label="Disconnect" variant="outlined" onPress={() => void terminal.disconnect()} />
        </Card>
      ) : null}

      <Card>
        <Label variant="subtitle" bold>
          {TAP_TO_PAY_NAME}
        </Label>
        <Label tone="secondary">
          Take contactless cards, phones and watches on this device, with no extra hardware.
        </Label>
        <Button
          label={status.kind === 'tapToPay' && status.connected ? `${TAP_TO_PAY_NAME} is ready` : `Use ${TAP_TO_PAY_NAME}`}
          busy={settingUp || terminal.discovering === 'tapToPay'}
          onPress={() => void startTapToPay()}
          testID="tap-to-pay-start"
        />
        <Button label="How to take a tap" variant="text" onPress={() => void howToTap()} />
      </Card>

      <Card>
        <Label variant="subtitle" bold>
          Bluetooth card reader
        </Label>
        <Label tone="secondary">Stripe Reader M2 or BBPOS WisePad 3. Turn the reader on, then search.</Label>
        {terminal.discovering === 'bluetooth' ? (
          <Button label="Stop searching" variant="outlined" onPress={() => void terminal.cancelDiscovery()} />
        ) : (
          <Button
            label="Search for readers"
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
        <Card testID="simulated-readers">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1) }}>
            <View style={{ flex: 1 }}>
              <Label bold>Simulated readers</Label>
              <Label tone="secondary">Test mode: use Stripe’s simulated readers and test cards.</Label>
            </View>
            <Switch
              value={simulated}
              onValueChange={setSimulated}
              accessibilityLabel="Simulated readers"
              trackColor={{ true: theme.palette.primary.main, false: theme.palette.inputOutline }}
            />
          </View>
        </Card>
      ) : null}
    </View>
  )
}
