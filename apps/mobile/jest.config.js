/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */
const path = require('node:path')

/**
 * The Aglyn app's own jest (AGL-3620), and the one that covers
 * `libs/mobile/*` and every plugin's `src/mobile`: the root jest has no
 * React Native, and the root `typecheck` skips mobile code for the same
 * reason. Bare imports resolve from THIS app's `node_modules` first, so a
 * lib file never picks up the web apps' React.
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
  roots: ['<rootDir>/src', path.join(repoRoot, 'libs/mobile'), path.join(repoRoot, 'libs/plugins')],
  testMatch: ['**/src/**/*.spec.ts', '**/src/**/*.spec.tsx'],
  // Under libs/plugins only the mobile entries are this app's to test; each
  // plugin's web specs belong to its own nx jest project.
  testPathIgnorePatterns: ['/node_modules/', '/libs/plugins/(?!.*/src/mobile/)'],
  moduleDirectories: ['node_modules', appModules],
  moduleNameMapper: workspaceMapper(),
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|firebase|@firebase/.*|react-native-webview|@tanstack/.*|nanoid))',
  ],
}
