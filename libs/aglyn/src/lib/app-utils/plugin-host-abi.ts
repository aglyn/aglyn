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
 * What the realm-plugin host ABI hands a signed bundle (AGL-420, AGL-3392):
 * the keys of `globalThis.__AGLYN_PLUGIN_HOST__`, which every app composes
 * from its OWN module instances.
 *
 * Two rules decide what is here. What must be ONE instance across the app and
 * a bundle comes from the host, or the bundle splits it silently. And a
 * library the site already runs is never compiled into a bundle a second time
 * — so the host holds it, and the realm build refuses to compile it in:
 *
 * - `React`, `jsxRuntime` — two Reacts cannot render one tree.
 * - `aglyn` — core's REALM PLUGIN SURFACE: the registries a bundle registers
 *   into and the vocabulary it registers with.
 * - `mui` — MUI's realm plugin surface: the components a site element is laid
 *   out, filled in and printed with, their class names, `useMediaQuery`, and
 *   `createSvgIcon` (how an icon from `@mui/icons-material` draws).
 * - `muiStyles` — the part of `@mui/material/styles` an element styles itself
 *   with: `styled`, `useTheme`, the color helpers, `css`, `keyframes`,
 *   `useColorScheme` — the site's theme and style cache behind them.
 *
 * Each is a short reviewed list of NAMES (`generate-realm-host-exports.mjs`),
 * read member by member and imported STATICALLY by the host module a page
 * loads only when it runs a realm plugin. Measured on the tenant build, both
 * shapes that looked cheaper cost every published page: an `import()` reaching
 * a library module re-cut the chunks every page loads, and a whole module
 * passed as a value (`import * as styles`) kept every one of its exports alive
 * in the page's own copy. Loading per export would also have tied every signed
 * bundle to the host's exact MUI version.
 *
 * One list, read by the apps that compose the host, the realm Rollup configs
 * that compile imports into lookups on it, and the bundle verifier that
 * refuses a lookup on any other key, and a name its module does not hold.
 * Adding a key is additive and keeps `PLUGIN_HOST_ABI_VERSION`; removing or
 * reshaping one is not.
 */
export const PLUGIN_HOST_ABI_KEYS = [
  'version',
  'React',
  'jsxRuntime',
  'aglyn',
  'mui',
  'muiStyles',
] as const

export type PluginHostAbiKey = (typeof PLUGIN_HOST_ABI_KEYS)[number]

/**
 * The keys that are SURFACES, whose names the verifier checks against what the
 * host holds (`realm-host-surface.generated.ts`).
 */
export const PLUGIN_HOST_MODULE_KEYS = ['aglyn', 'mui', 'muiStyles'] as const

export type PluginHostModuleKey = (typeof PLUGIN_HOST_MODULE_KEYS)[number]

/** The global the host ABI is published on. */
export const PLUGIN_HOST_GLOBAL = '__AGLYN_PLUGIN_HOST__'
