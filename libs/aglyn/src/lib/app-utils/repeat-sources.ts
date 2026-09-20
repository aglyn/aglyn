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

import type { AglynAttributeSchema } from '../foundation/definitions/components.types'
import type { RepeatableDataset } from './expand-repeatables'

/**
 * Where a repeat's rows come from, for the editor (AGL-3111).
 *
 * Any element can repeat, and the platform decides what a repeat MEANS — the
 * scope, the copies, the bounds (`expand-repeatables.ts`). What it does not
 * decide is what an element repeats OVER. That belongs to the plugin that owns
 * the rows, which registers a source here from the registration function its
 * loader calls by name. Core names no source.
 *
 * Reached by path, never through a barrel: nothing on a published page asks
 * where rows come from, so nothing here is in a published page's download.
 */

/**
 * What a source answers for one key.
 *
 * - `loading` — no answer yet.
 * - `missing` — the key names nothing this site may use. The published page
 *   renders the element once, as written.
 * - `error` — the read failed. Nothing is known about the rows.
 * - `ready` — the rows, read and bounded exactly as the published page's
 *   composition reads them.
 */
export type RepeatRowsAnswer =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | {
      status: 'ready'
      /** The name authors know the entry by, for the canvas badge. */
      label: string
      /**
       * The rows under every key the expansion looks them up by: the key as
       * the node stores it, the entry's id, and each entry a one-hop reference
       * in the rows reads (`{{item.ref.field}}`).
       */
      rowsByKey: Readonly<Record<string, RepeatableDataset>>
    }

/** One read a source is asked for. */
export interface RepeatRowsRequest {
  /** The site the canvas edits. A source answers only what it may show. */
  hostId: string
  /** The key exactly as the node stores it. */
  key: string
}

/** One kind of thing an element can repeat over. */
export interface RepeatSource {
  /** Stable id, e.g. the plugin's name for the kind. */
  id: string
  /** What the Attributes panel calls the kind. */
  label: string
  /**
   * The node prop the chosen key persists under. Persisted in documents, so a
   * source never renames it.
   */
  keyProp: string
  /**
   * The attribute that picks a key, drawn by the Attributes panel as any
   * component attribute is. The panel names the field after `keyProp`.
   */
  keyAttribute: Omit<AglynAttributeSchema, 'name'>
  /**
   * Reads one key's rows for the besigner's canvas preview and badge. A React
   * hook: the editor mounts one reader per key and calls it unconditionally,
   * so its identity must not change after registration.
   */
  useRows(request: RepeatRowsRequest): RepeatRowsAnswer
}

const sources = new Map<string, RepeatSource>()
const listeners = new Set<() => void>()
let version = 0
/**
 * Replaced only when the registered set changes, never rebuilt per call: it is
 * the snapshot `useSyncExternalStore` compares, and a fresh array every time
 * is a render loop rather than a wasted allocation.
 */
let snapshot: readonly RepeatSource[] = []

const notify = () => {
  version += 1
  snapshot = [...sources.values()]
  for (const listener of [...listeners]) listener()
}

/**
 * Registers a source, replacing any registered under its id. Returns the
 * unregister, which removes the source only if it is still the one registered.
 *
 * Call it from a registration function the plugin loader calls BY NAME, never
 * from a module's top level: a bundler deletes a module imported only for its
 * side effect when its package says it has none (AGL-3025).
 */
export function registerRepeatSource(source: RepeatSource): () => void {
  if (sources.get(source.id) !== source) {
    sources.set(source.id, source)
    notify()
  }
  return () => {
    if (sources.get(source.id) !== source) return
    sources.delete(source.id)
    notify()
  }
}

/**
 * Every registered source, in registration order. The SAME array until the
 * registered set changes, so it can be read as a store snapshot.
 */
export function listRepeatSources(): readonly RepeatSource[] {
  return snapshot
}

/** The source registered under `id`. */
export function getRepeatSource(id: string): RepeatSource | undefined {
  return sources.get(id)
}

/** Called after the registered set changes. Returns the unsubscribe. */
export function subscribeRepeatSources(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Moves on every change — the snapshot `useSyncExternalStore` reads. */
export function getRepeatSourcesVersion(): number {
  return version
}

/**
 * The registered source a node repeats over, and the key it names, trimmed.
 * `undefined` for a node that repeats over nothing a registered source owns.
 */
export function repeatSourceOf(
  node: unknown,
): { source: RepeatSource; key: string } | undefined {
  const props = (node as { props?: Record<string, unknown> } | undefined)?.props
  if (!props) return undefined
  for (const source of sources.values()) {
    const value = props[source.keyProp]
    const key = typeof value === 'string' ? value.trim() : ''
    if (key) return { source, key }
  }
  return undefined
}
