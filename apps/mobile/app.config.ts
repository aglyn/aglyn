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
 * The Aglyn app's Expo config (AGL-3620).
 *
 * Environment (all optional in development, where the app runs against the
 * local Firebase emulators and a local console):
 *
 *   EXPO_PUBLIC_CONSOLE_ORIGIN     the console, e.g. https://console.aglyn.com
 *   EXPO_PUBLIC_FIREBASE_API_KEY   the Firebase web config the console uses
 *   EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
 *   EXPO_PUBLIC_FIREBASE_PROJECT_ID
 *   EXPO_PUBLIC_FIREBASE_APP_ID
 *   EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET
 *   EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
 *   EXPO_PUBLIC_USE_EMULATORS      "1" to talk to the emulators (default in development)
 *   EXPO_PUBLIC_EMULATOR_HOST      default 127.0.0.1 (the iOS Simulator shares the Mac's loopback)
 *   EAS_PROJECT_ID                 the EAS project, once Zach has created it (push in production)
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConfigContext, ExpoConfig } from 'expo/config'

// The console's palette, as the mobile theme reads it (generated JSON, read
// as data: this file runs in Node under the Expo CLI, never in the app).
const { light, dark } = JSON.parse(
  readFileSync(join(__dirname, '../../libs/mobile/ui/src/lib/tokens.generated.json'), 'utf8'),
)

// The product name, as `readMobileConfig` reads it at runtime (AGL-2153).
const BRAND = process.env.EXPO_PUBLIC_BRAND_NAME ?? 'Aglyn'

// The same variable and default `readMobileConfig` (libs/mobile/core) reads at runtime.
const CONSOLE_ORIGIN = process.env.EXPO_PUBLIC_CONSOLE_URL ?? 'https://app.aglyn.com'
const consoleHost = new URL(CONSOLE_ORIGIN).hostname
const universalLinkHosts = consoleHost === 'localhost' ? [] : [consoleHost]

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: BRAND,
  slug: 'aglyn',
  version: '1.0.0',
  scheme: 'aglyn',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  // tsconfig.paths.generated.json maps bare packages to their TYPES (react →
  // @types/react) for the compiler; Metro must never read it. metro.config.js
  // resolves the workspace aliases itself.
  experiments: { tsconfigPaths: false },
  ios: {
    bundleIdentifier: 'com.aglyn.app',
    supportsTablet: true,
    // Split View and Slide Over on iPad need the app to accept every size.
    requireFullScreen: false,
    associatedDomains: universalLinkHosts.map((host) => `applinks:${host}`),
    infoPlist: {
      NSFaceIDUsageDescription: `${BRAND} uses Face ID to unlock the app.`,
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.aglyn.app',
    adaptiveIcon: {
      backgroundColor: light.background.default,
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    intentFilters: universalLinkHosts.map((host) => ({
      action: 'VIEW',
      autoVerify: true,
      data: [{ scheme: 'https', host }],
      category: ['BROWSABLE', 'DEFAULT'],
    })),
  },
  plugins: [
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: light.background.default,
        dark: { image: './assets/splash-icon.png', backgroundColor: dark.background.default },
      },
    ],
    'expo-secure-store',
    ['expo-local-authentication', { faceIDPermission: `${BRAND} uses Face ID to unlock the app.` }],
    [
      'expo-notifications',
      { color: light.primary.main, defaultChannel: 'default' },
    ],
  ],
  // Runtime settings are EXPO_PUBLIC_* variables inlined at bundle time and
  // read by src/config.ts; only the EAS project id lives here.
  extra: {
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
})
