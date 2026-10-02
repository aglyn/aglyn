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
 * HOW THIS PROCESS DROPS ONE SITE'S CACHED PAGES, for a write that worked out
 * which of them it made stale (AGL-3113, AGL-3080).
 *
 * A record write — a dataset row, a collection entry — refreshes the pages
 * that show it, and nothing else. Working out WHICH pages is the writer's: the
 * data plugin walks the pages that repeat over a dataset, the collection scan
 * the pages that list an entry. HOW a page is dropped is the runtime's, and
 * the two runtimes do it differently: the tenant drops its own caches in
 * process, and the console announces over the shared secret and passes its own
 * dropper at the call site. So the deployment that owns the caches registers
 * the dropper here, and a writer reads it; neither names the other.
 *
 * ## One per process, on `globalThis`
 *
 * The tenant registers from `instrumentation.ts`, by name, at boot. Next
 * compiles that file apart from the routes, so a dropper held in a module
 * `let` was set in the boot's copy of this module and read as missing by
 * every route's copy — a form submission or an automation step that wrote a
 * row logged `no-live-page-dropper` and left the pages stale for the rest of
 * their window (AGL-3412 was the same split for the plugin services). Keyed on
 * `globalThis` under `Symbol.for`, every copy in a realm reads the one slot.
 */

/** One site's share of a change: the pages on it that must be dropped. */
export interface LivePageTarget {
  hostId: string
  /** The tenant keys its cache on this, never on `hostId`. */
  subdomain: string
  /** The attached custom domain, whose pages live under a second cache key. */
  cname?: string
  /** Site-absolute addresses (`/`, `/team`) the change makes stale. */
  paths: string[]
  /** The site held more documents than the scan read, so `paths` is partial. */
  truncated: boolean
}

/**
 * Drops one site's cached pages. Returns whether the drop landed. It must
 * never throw: everything above it has already been written.
 */
export type LivePageDropper = (target: LivePageTarget) => Promise<boolean>

const DROPPER_KEY = Symbol.for('@aglyn/tenant-data-admin:live-page-dropper')

const globalScope = globalThis as typeof globalThis & {
  [DROPPER_KEY]?: LivePageDropper
}

/**
 * Registers the dropper for this process, replacing any previous one. Returns
 * the unregister, which removes it only if it is still the one registered.
 *
 * Called from a function the platform calls BY NAME at boot, never from a
 * module's top level: a bundler deletes a module imported only for its side
 * effect when its package says it has none (AGL-3025).
 */
export function registerLivePageDropper(drop: LivePageDropper): () => void {
  globalScope[DROPPER_KEY] = drop
  return () => {
    if (globalScope[DROPPER_KEY] === drop) delete globalScope[DROPPER_KEY]
  }
}

/** The dropper this process registered, or `undefined` when none did. */
export function registeredLivePageDropper(): LivePageDropper | undefined {
  return globalScope[DROPPER_KEY]
}
