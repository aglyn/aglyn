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

'use client'

import { AGLYN_HOST_SURFACE } from '@aglyn/aglyn/plugin-manager/realm-host-aglyn.generated'
import { setRealmPluginHost } from '@aglyn/aglyn/plugin-manager/realm-plugins'
import {
  MUI_HOST_SURFACE,
  MUI_STYLES_HOST_SURFACE,
} from './realm-host-mui.generated'

/**
 * Composes `__AGLYN_PLUGIN_HOST__` for the realm bundles a console screen runs
 * (AGL-420, AGL-3392): the module instances that must be ONE across the app
 * and a bundle, and nothing else (`plugin-host-abi.ts` says why each is here).
 *
 * Core, MUI and MUI's styling come as their realm plugin SURFACES — named
 * lists of exports, read one by one so the rest of each module still shakes
 * out of the page's own copy. A bundle compiles none of them in: the page
 * already runs them, so nothing it uses is downloaded twice. The host used to
 * hand over all of core as one namespace, which a bundler cannot tree-shake:
 * 254 KB on the wire for every page that ran a realm plugin.
 *
 * Reached only by a relative `import()` from `realm-plugins.client.ts`, so a
 * page that runs no realm plugin never loads this module. Its imports are
 * static on purpose: every `import()` reaching a library module made Turbopack
 * re-cut the chunks every published page loads (`generate-realm-host-exports.mjs`
 * has the measurements).
 *
 * React and the JSX runtime come from the caller — the blank-canvas invariant
 * is that a remote bundle shares THIS bundle's React singleton.
 *
 * The tenant twin is `apps/tenant/utils/realm-plugin-host.client.ts`.
 */
// The loader and the registry it holds bundles to travel with the host, so a
// screen that runs no realm plugin carries neither (AGL-3390).
export { components as realmRegistry } from '@aglyn/aglyn/aglyn'
export { loadRealmPlugins } from '@aglyn/aglyn/plugin-manager/realm-plugins'

export function composeRealmPluginHost(host: {
  React: unknown
  jsxRuntime: unknown
}): void {
  setRealmPluginHost({
    ...host,
    aglyn: AGLYN_HOST_SURFACE,
    mui: MUI_HOST_SURFACE,
    muiStyles: MUI_STYLES_HOST_SURFACE,
  })
}
