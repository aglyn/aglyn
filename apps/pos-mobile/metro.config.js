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
 * Metro for the Aglyn POS app inside the monorepo (AGL-3618), the same
 * arrangement as apps/mobile (AGL-3620).
 *
 * The app is its own npm install (`apps/pos-mobile/node_modules`): React Native
 * pins an exact React that is not the web apps' React, so the two can never
 * share one tree. Three things follow:
 *
 *  - every bare import resolves from THIS app's node_modules
 *    (`nodeModulesPaths`), including imports made by files under `libs/`;
 *    the repo root's node_modules is block-listed, so a lib walking up can
 *    never pick up the web apps' React. Hierarchical lookup stays on inside
 *    the app's own tree, where packages nest their own dependencies
 *    (`expo/node_modules/expo-asset`);
 *  - the workspace's `@aglyn/*` aliases come from `tsconfig.base.json`, the
 *    same table the compiler and nx read, so there is one map, not two;
 *  - Metro watches `libs/` (where the foundation and plugin `./mobile`
 *    entries live), never the repo root and its web node_modules.
 *
 * What a mobile bundle may reach at all is `check-mobile-isolation`'s job.
 */

const { getDefaultConfig } = require('expo/metro-config')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const projectRoot = __dirname
const repoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

config.watchFolders = [path.join(repoRoot, 'libs')]
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules')]
config.resolver.blockList = [
  new RegExp(`^${escapeRegExp(path.join(repoRoot, 'node_modules'))}/`),
  /\/libs\/.*\/node_modules\/.*/,
  // Build output in the workspace, never a package's own `dist` (Firebase
  // ships from one).
  new RegExp(`^${escapeRegExp(path.join(repoRoot, 'dist'))}/`),
  /\/libs\/.*\/\.next\//,
]

/** `@aglyn/x` and `@aglyn/x/*` → absolute paths, from tsconfig.base.json. */
function workspaceAliases() {
  const base = JSON.parse(readFileSync(path.join(repoRoot, 'tsconfig.base.json'), 'utf8'))
  const exact = new Map()
  const prefix = []
  for (const [alias, [target]] of Object.entries(base.compilerOptions.paths)) {
    const absolute = path.join(repoRoot, target)
    if (alias.endsWith('/*')) {
      prefix.push([alias.slice(0, -1), absolute.slice(0, -1)])
    } else {
      exact.set(alias, absolute)
    }
  }
  // Longest prefix first, so `@aglyn/x-y/*` never loses to `@aglyn/x/*`.
  prefix.sort((a, b) => b[0].length - a[0].length)
  return { exact, prefix }
}

const aliases = workspaceAliases()

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@aglyn/')) {
    const exact = aliases.exact.get(moduleName)
    if (exact) return context.resolveRequest(context, exact, platform)
    for (const [from, to] of aliases.prefix) {
      if (moduleName.startsWith(from)) {
        return context.resolveRequest(context, to + moduleName.slice(from.length), platform)
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
