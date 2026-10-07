/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */
const path = require('node:path')
const fs = require('node:fs')
const { getDefaultConfig } = require('expo/metro-config')

/**
 * Metro for a standalone app inside the Nx repo (AGL-3618).
 *
 * The app compiles the shared mobile source in `libs/mobile/*` (and nothing
 * else outside its own folder), and resolves EVERY bare import, those libs'
 * included, from this app's own `node_modules`. The root `node_modules` holds
 * the web apps' React 19.3, MUI and Next; letting Metro walk up into it would
 * bundle a second React. So it is block-listed outright, by both its path and
 * its real path (agent worktrees symlink it).
 */
const appRoot = __dirname
const repoRoot = path.resolve(appRoot, '../..')
const config = getDefaultConfig(appRoot)

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const rootModules = path.join(repoRoot, 'node_modules')
const blocked = new Set([rootModules])
try {
  blocked.add(fs.realpathSync(rootModules))
} catch {
  // No root install: nothing to block.
}

config.watchFolders = [path.join(repoRoot, 'libs/mobile')]
config.resolver.nodeModulesPaths = [path.join(appRoot, 'node_modules')]
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  ...[...blocked].map((dir) => new RegExp(`^${escape(dir)}/.*`)),
]
config.resolver.extraNodeModules = {
  '@aglyn/mobile-core': path.join(repoRoot, 'libs/mobile/core/src'),
  '@aglyn/mobile-ui': path.join(repoRoot, 'libs/mobile/ui/src'),
  '@aglyn/mobile-webview': path.join(repoRoot, 'libs/mobile/webview/src'),
}

module.exports = config
