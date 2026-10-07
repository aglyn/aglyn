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

import { Button, Card, Label, Screen, useMobileTheme } from '@aglyn/mobile-ui'
import { Platform, View } from 'react-native'
import { canShowAppleHowToTap, showAppleHowToTap } from '../../modules/tap-to-pay-education'

/*==========================================
 * TAP TO PAY MERCHANT EDUCATION (AGL-3618).
 *
 * Apple requires an app that enables Tap to Pay on iPhone to show the
 * merchant how to take a tap before the first payment, and to keep that
 * reachable afterwards. On iOS 18 and later this is Apple's OWN content
 * (`ProximityReaderDiscovery`, through the local `tap-to-pay-education`
 * module), which Apple keeps current and localized. Earlier iOS versions and
 * Android get these screens, which say the same three things.
 *=========================================*/

export const TAP_TO_PAY_NAME = Platform.OS === 'ios' ? 'Tap to Pay on iPhone' : 'Tap to Pay on Android'

export const EDUCATION_STEPS: ReadonlyArray<{ title: string; body: string }> =
  Platform.OS === 'ios'
    ? [
        {
          title: 'Hold the card near the top of the iPhone',
          body: 'Ask the customer to hold their card, phone or watch flat against the top of your iPhone, above the screen prompt.',
        },
        {
          title: 'Wait for the check mark',
          body: 'Keep it there until the screen shows a check mark and you hear the tone. That usually takes a second or two.',
        },
        {
          title: 'Enter a PIN if asked',
          body: 'Some cards and larger amounts ask for a PIN. Hand the iPhone to the customer to enter it on the secure keypad.',
        },
      ]
    : [
        {
          title: 'Find the tap spot',
          body: 'The screen shows where to tap. On most phones it is the middle of the back, where the NFC antenna is.',
        },
        {
          title: 'Hold the card still',
          body: 'Ask the customer to hold their card, phone or watch against that spot until the screen confirms it.',
        },
        {
          title: 'Enter a PIN if asked',
          body: 'Some cards ask for a PIN. Hand the phone to the customer to enter it; the keypad moves around on purpose.',
        },
      ]

/**
 * Shows Apple's content when it can; otherwise renders the fallback steps.
 * `onDone` runs once the merchant has seen one or the other.
 */
export async function presentHowToTap(): Promise<'apple' | 'fallback'> {
  if (canShowAppleHowToTap() && (await showAppleHowToTap())) return 'apple'
  return 'fallback'
}

export function TapToPayEducationScreen(props: { onDone: () => void }) {
  const theme = useMobileTheme()
  return (
    <Screen testID="tap-to-pay-education">
      <View style={{ gap: theme.spacing(2) }}>
        <Label variant="headline">How to take a payment with {TAP_TO_PAY_NAME}</Label>
        {EDUCATION_STEPS.map((step, index) => (
          <Card key={step.title}>
            <Label variant="subtitle" bold>
              {`${index + 1}. ${step.title}`}
            </Label>
            <Label tone="secondary">{step.body}</Label>
          </Card>
        ))}
        <Button label="Got it" onPress={props.onDone} testID="tap-to-pay-education-done" />
      </View>
    </Screen>
  )
}
