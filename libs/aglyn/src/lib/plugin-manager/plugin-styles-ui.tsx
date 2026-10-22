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
 * The React half of the plugin stylesheet route (AGL-2486). Its registry twin
 * is `plugin-styles.ts`.
 *
 * ## Why this is a separate file, and NOT on the `@aglyn/aglyn` barrel
 *
 * It was one file to begin with, and that took the dev server to a 500 on
 * every route. `plugin-manager/index.ts` is re-exported by `lib/aglyn.ts`,
 * which `src/server.ts` re-exports in turn — so anything in the plugin-manager
 * barrel is reachable from a SERVER route, and a module calling a client-only
 * React hook (`useSyncExternalStore`) is not. Same family as the recorded
 * `plugin-manager` → `app-utils/api-plugins` cycle: the barrel is the hazard,
 * and the fix is to keep the shared state in a leaf both sides can import and
 * leave the client-only piece off the barrel entirely.
 *
 * So: the REGISTRY (`registerPluginStyles`, `capturePluginStyles`, the store)
 * is plain TypeScript with no React import and stays on the barrel, because
 * `realm-plugins.ts` — which is isomorphic — has to call the capture. This
 * component is deep-imported instead:
 *
 *     import { PluginStyles } from './plugin-styles-ui'
 *
 * exactly as `app-utils/consent-banner-ui` already is. Do not add it to
 * `plugin-manager/index.ts`; that is the change that breaks every route.
 *
 * If a route starts 500ing right after you touch this, RESTART the dev server
 * before doubting the edit — Turbopack serves the stale server chunk and
 * neither an edit nor a hard reload clears it.
 *
 * No `'use client'` directive: inside @aglyn/aglyn the directive splits the
 * bundler into a duplicate module graph and the second canvas singleton
 * renders the tenant blank (AGL-52). Every importer is itself a client module.
 */

import { type ReactElement, useSyncExternalStore } from 'react'
import {
  listPluginStyles,
  type PluginStylesScope,
  subscribeToPluginStyles,
} from './plugin-styles'

/**
 * Renders every plugin stylesheet that belongs on this surface, as plain
 * `<style>` children — so they land wherever the tree lands: the document on
 * the published tenant and in Preview, inside the closed shadow root on the
 * besigner canvas.
 *
 * Unlayered by construction, which is the whole point: that is the slot a
 * plugin's CSS occupies on the published page, and reproducing the SLOT is
 * what makes the editor agree with the published page about which rule wins.
 * Do not route this through an emotion cache — the layered cache would put
 * plugin CSS inside `@layer mui`, where it would start LOSING to component
 * defaults it currently beats.
 *
 * Subscribed rather than read once: realm bundles load asynchronously (post
 * hydration on the tenant, alongside the console shell in the editor), so the
 * canvas is routinely mounted before any plugin has registered anything.
 */
export function PluginStyles(props?: {
  scope?: PluginStylesScope
}): ReactElement {
  const scope = props?.scope ?? 'document'
  const all = useSyncExternalStore(
    subscribeToPluginStyles,
    listPluginStyles,
    listPluginStyles,
  )
  const visible = all.filter((sheet) => scope === 'shadow' || !sheet.mirrored)
  return (
    <>
      {visible.map((sheet) => (
        <style
          key={`${sheet.pluginId}\x00${sheet.styleId}`}
          data-aglyn-plugin-styles={`${sheet.pluginId}:${sheet.styleId}`}
        >
          {sheet.css}
        </style>
      ))}
    </>
  )
}
