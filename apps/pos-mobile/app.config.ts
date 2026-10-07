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

import type { ConfigContext, ExpoConfig } from 'expo/config'

/**
 * Aglyn POS (AGL-3618): the register app, `com.aglyn.pos`.
 *
 * ## The Tap to Pay entitlement is a build flag
 *
 * `com.apple.developer.proximity-reader.payment.acceptance` can be signed
 * into a build only once Apple has granted it to the team, and a simulator
 * or dev build signed without it fails to install if it is declared. So it
 * is added only when `AGLYN_POS_TAP_TO_PAY_ENTITLEMENT=1`; every other build
 * still discovers Tap to Pay in simulated mode, which needs no entitlement.
 *
 * ## Android
 *
 * The Terminal SDK refuses to run below API 26 and builds against 35
 * (its README); Tap to Pay on Android additionally needs Android 13 on the
 * device, which the SDK checks at discovery. `tapToPayCheck` adds the
 * `TapToPay.isInTapToPayProcess()` guard Stripe requires at the top of
 * `Application.onCreate`, because Tap to Pay runs in its own process.
 */
const tapToPayEntitlement = process.env.AGLYN_POS_TAP_TO_PAY_ENTITLEMENT === '1'

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Aglyn POS',
  slug: 'aglyn-pos',
  owner: process.env.EXPO_OWNER || undefined,
  scheme: 'aglynpos',
  version: '1.0.0',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.aglyn.pos',
    supportsTablet: true,
    requireFullScreen: false,
    entitlements: tapToPayEntitlement
      ? { 'com.apple.developer.proximity-reader.payment.acceptance': true }
      : {},
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.aglyn.pos',
    adaptiveIcon: {
      backgroundColor: '#FFFFFF',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.NFC',
    ],
  },
  plugins: [
    [
      'expo-build-properties',
      {
        ios: { deploymentTarget: '16.4' },
        android: { minSdkVersion: 26, compileSdkVersion: 35, targetSdkVersion: 35 },
      },
    ],
    [
      '@stripe/stripe-terminal-react-native',
      {
        bluetoothBackgroundMode: true,
        locationWhenInUsePermission:
          'Aglyn POS uses your location to confirm card payments are taken where your store is, as card networks require.',
        bluetoothPeripheralPermission:
          'Aglyn POS connects to your Bluetooth card reader to take payments.',
        bluetoothAlwaysUsagePermission:
          'Aglyn POS connects to your Bluetooth card reader to take payments.',
        tapToPayCheck: true,
      },
    ],
    'expo-web-browser',
  ],
  extra: {
    tapToPayEntitlement,
  },
})
