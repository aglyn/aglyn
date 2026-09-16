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

import { CONSOLE_PLUGIN_MANIFEST } from './plugins.client.generated'

/**
 * The plugins the staff area loads (AGL-2939): every manifest entry that
 * names a `staff` register surface.
 *
 * The org routes load each workspace's enabled plugins; a staff page names
 * no workspace, so it cannot borrow that set — the ambient org is whichever
 * one the reader last opened, and has nothing to do with the org or account
 * the staff page is about. The staff zones read this list instead, and the
 * staff area's layout loads these plugins before any staff page renders.
 *
 * Its own module, beside the loader rather than inside it: the widget slot
 * reads the ids on every page, and the loader module registers the plugins'
 * declarations when it is first imported.
 */
export const STAFF_PLUGIN_IDS: readonly string[] = CONSOLE_PLUGIN_MANIFEST.filter(
  (entry) => Boolean(entry.register['staff']),
).map((entry) => entry.id)

/**
 * Whether the staff area's plugin load has settled, for the chrome above the
 * staff layout. The staff pages wait for it inside the layout; the staff tab
 * strip is drawn above every route boundary and cannot, so it subscribes and
 * redraws its plugin tabs when the load lands.
 */
let settled = false
const listeners = new Set<() => void>()

/** Records the load as settled and tells every subscriber, once. */
export function markStaffPluginsSettled(): void {
  if (settled) return
  settled = true
  for (const listener of [...listeners]) listener()
}

export function staffPluginsSettled(): boolean {
  return settled
}

/** A `useSyncExternalStore` subscription to {@link staffPluginsSettled}. */
export function subscribeStaffPluginsSettled(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test seam: the load has not settled. */
export function resetStaffPluginsSettledForTests(): void {
  settled = false
}
