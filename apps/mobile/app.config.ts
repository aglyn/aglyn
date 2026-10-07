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
 * Environment, read at bundle time (`EXPO_PUBLIC_*` are inlined by Metro and
 * read by src/config.ts through `readMobileConfig`); README.md has the full
 * table and what each production value comes from:
 *
 *   EXPO_PUBLIC_CONSOLE_URL            the console origin (default https://app.aglyn.com)
 *   EXPO_PUBLIC_FIREBASE_API_KEY       the Firebase config of the app registered in Firebase
 *   EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
 *   EXPO_PUBLIC_FIREBASE_PROJECT_ID
 *   EXPO_PUBLIC_FIREBASE_APP_ID
 *   EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET
 *   EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
 *   EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST   host:port, local stack only
 *   EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST       host:port, local stack only
 *   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID / EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID   Google sign-in, hidden until set
 *   EXPO_PUBLIC_BRAND_NAME             the product name (default Aglyn)
 *   EAS_PROJECT_ID                     the EAS project; push registration is inert until it is set
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
    // Commerce (AGL-3621): scan product and tracking barcodes, photograph products.
    [
      'expo-camera',
      {
        cameraPermission: `${BRAND} uses the camera to scan barcodes and take product photos.`,
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: `${BRAND} opens your photos so you can add them to products.`,
        cameraPermission: `${BRAND} uses the camera to scan barcodes and take product photos.`,
        microphonePermission: false,
      },
    ],
  ],
  // Runtime settings are EXPO_PUBLIC_* variables inlined at bundle time and
  // read by src/config.ts; only the EAS project id lives here.
  extra: {
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
})
