/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */
const path = require('node:path')

/**
 * Aglyn POS's own jest (AGL-3618): the shell, `libs/mobile/*` against this
 * app's install, and the `src/mobile` of each plugin its manifest loads. The
 * root jest has no React Native, and the root `typecheck` skips mobile code
 * for the same reason. Bare imports resolve from THIS app's `node_modules`
 * first, so a lib file never picks up the web apps' React.
 */
const { readFileSync } = require('node:fs')

const repoRoot = path.join(__dirname, '../..')

/** The workspace's `@aglyn/*` aliases from tsconfig.base.json, the one map the compiler and Metro read too. */
function workspaceMapper() {
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const { paths } = JSON.parse(readFileSync(path.join(repoRoot, 'tsconfig.base.json'), 'utf8')).compilerOptions
  const entries = Object.entries(paths).map(([alias, [target]]) => {
    const absolute = path.join(repoRoot, target)
    return alias.endsWith('/*')
      ? [`^${escape(alias.slice(0, -1))}(.*)$`, absolute.replace(/\*$/, '$1')]
      : [`^${escape(alias)}$`, absolute]
  })
  // Exact aliases first, then the longest prefix: jest takes the first match.
  return Object.fromEntries(entries.sort(([a], [b]) => Number(b.endsWith('(.*)$') === false) - Number(a.endsWith('(.*)$') === false) || b.length - a.length))
}
const appModules = path.join(__dirname, 'node_modules')

module.exports = {
  preset: 'jest-expo',
  // Its own cache: the default is shared with every other jest on the machine.
  cacheDirectory: path.join(__dirname, 'node_modules/.cache/jest'),
  rootDir: __dirname,
  roots: [
    '<rootDir>/src',
    '<rootDir>/modules',
    path.join(repoRoot, 'libs/mobile'),
    // The plugin code this app's manifest loads; the rest of each plugin's
    // mobile entry is the Aglyn app's to test.
    path.join(repoRoot, 'libs/plugins/commerce/src/mobile/pos'),
    path.join(repoRoot, 'libs/plugins/bookings/src/mobile'),
  ],
  setupFiles: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/*.spec.ts', '**/*.spec.tsx'],
  testPathIgnorePatterns: ['/node_modules/'],
  moduleDirectories: ['node_modules', appModules],
  moduleNameMapper: workspaceMapper(),
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|firebase|@firebase/.*|react-native-webview|@stripe/stripe-terminal-react-native|@tanstack/.*|nanoid))',
  ],
}
