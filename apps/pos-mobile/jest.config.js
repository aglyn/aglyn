/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */
const path = require('node:path')

/**
 * The app's own jest (AGL-3618), and the one that covers `libs/mobile/*`:
 * the root jest has no React Native, and the root `typecheck` skips mobile
 * code for the same reason. Bare imports resolve from THIS app's
 * `node_modules` first, so a lib file never picks up the web apps' React.
 */
const appModules = path.join(__dirname, 'node_modules')

module.exports = {
  preset: 'jest-expo',
  rootDir: __dirname,
  roots: ['<rootDir>/src', '<rootDir>/modules', path.join(__dirname, '../../libs/mobile')],
  moduleDirectories: ['node_modules', appModules],
  moduleNameMapper: {
    '^@aglyn/mobile-core$': '<rootDir>/../../libs/mobile/core/src/index.ts',
    '^@aglyn/mobile-ui$': '<rootDir>/../../libs/mobile/ui/src/index.ts',
    '^@aglyn/mobile-webview$': '<rootDir>/../../libs/mobile/webview/src/index.ts',
  },
  testMatch: ['**/*.spec.ts', '**/*.spec.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@stripe/stripe-terminal-react-native|firebase|@firebase/.*|react-native-webview))',
  ],
}
