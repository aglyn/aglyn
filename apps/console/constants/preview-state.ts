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

import {
  type AglynHostTheme,
  type NodesMap,
  writeLocalStorageWithBudget,
} from '@aglyn/aglyn'

/** Every key this module owns; also the set it is allowed to evict. */
export const PREVIEW_STATE_KEY_PREFIX = 'aglyn:preview:'

/**
 * Which kind of besigner document a preview snapshot came from (AGL-1203).
 *
 * The kind is part of the storage key, not decoration: component, layout,
 * template and screen ids are minted from the same generator and live in
 * sibling collections, so two documents can legitimately share an id. Without
 * the kind, previewing a layout could read a screen's snapshot.
 */
export type PreviewKind =
  | 'screen'
  | 'component'
  | 'layout'
  | 'template'
  | 'form'

export interface PreviewStateIds {
  hostId: string
  kind: PreviewKind
  /** Screen / component / layout / template / form id. */
  docId: string
  /** Templates version but never publish, so they have no versionId. */
  versionId?: string
}

export interface PreviewState {
  nodes: NodesMap
  /** Host theme at snapshot time so the preview styles like the live site. */
  theme?: AglynHostTheme
  updatedAt: number
}

export function previewStateKey(ids: PreviewStateIds): string {
  const version = ids.versionId ?? 'current'
  return (
    `${PREVIEW_STATE_KEY_PREFIX}${ids.kind}:` +
    `${ids.hostId}:${ids.docId}:${version}`
  )
}

export function previewWindowName(ids: PreviewStateIds): string {
  const version = ids.versionId ?? 'current'
  return `aglyn-preview-${ids.kind}-${ids.hostId}-${ids.docId}-${version}`
}

/**
 * Returns false when the origin was too full to hold the snapshot even after
 * evicting older ones — the caller opens the preview window regardless, and
 * it reads whatever it finds.
 *
 * A preview snapshot is the cheapest thing in storage: pressing Preview
 * again regenerates it exactly. So this evicts only its own keys, and
 * `besigner-draft-store` is deliberately allowed to evict these ahead of
 * anyone's unsaved work (AGL-1256).
 */
export function writePreviewState(
  ids: PreviewStateIds,
  nodes: NodesMap,
  theme?: AglynHostTheme,
): boolean {
  const state: PreviewState = { nodes, theme, updatedAt: Date.now() }
  const key = previewStateKey(ids)
  prunePreviewStates({ now: state.updatedAt, keep: key })
  return writeLocalStorageWithBudget({
    key,
    value: JSON.stringify(state),
    evictPrefixes: [PREVIEW_STATE_KEY_PREFIX],
  }).ok
}

export function readPreviewState(ids: PreviewStateIds): PreviewState | null {
  const raw = window.localStorage.getItem(previewStateKey(ids))
  if (!raw) return null
  try {
    const state = JSON.parse(raw) as PreviewState
    return state?.nodes ? state : null
  } catch {
    return null
  }
}

/**
 * A snapshot older than this is dropped. The preview window reads its
 * snapshot when it opens (and on a reload); a day covers any preview anyone
 * is still looking at, and Preview writes a fresh one on every click.
 */
export const PREVIEW_STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * All snapshots together stay under this many characters, newest kept first.
 * localStorage holds ~5 M characters per origin and the Firestore client
 * writes its tab-sync records there: a full origin fails the whole client
 * (`INTERNAL ASSERTION FAILED (b815)`, see `firestore-shared-client-state.ts`).
 * Evicting only once the origin was full (AGL-1256) let one browser
 * profile pile up 3.2 M characters of snapshots (AGL-4204).
 */
export const PREVIEW_STATE_MAX_CHARS = 1_000_000

type PruneStorage = Pick<Storage, 'getItem' | 'removeItem' | 'key' | 'length'>

/** `updatedAt` is the last field `writePreviewState` writes. */
function snapshotWrittenAt(raw: string): number {
  const match = /"updatedAt":(\d+)\}$/.exec(raw.slice(-48))
  return match ? Number(match[1]) : 0
}

/**
 * Drops snapshots older than {@link PREVIEW_STATE_MAX_AGE_MS}, then the
 * oldest until the rest fit in {@link PREVIEW_STATE_MAX_CHARS}. `keep` (the
 * snapshot about to be written) is never dropped and does not count. Only
 * this module's keys are ever touched. Never throws.
 */
export function prunePreviewStates({
  now = Date.now(),
  keep,
  storage,
}: { now?: number; keep?: string; storage?: PruneStorage } = {}): string[] {
  const removed: string[] = []
  try {
    const store: PruneStorage | undefined =
      storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
    if (!store) return removed
    const snapshots: Array<{ key: string; size: number; at: number }> = []
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index)
      if (!key?.startsWith(PREVIEW_STATE_KEY_PREFIX) || key === keep) continue
      const raw = store.getItem(key) ?? ''
      snapshots.push({
        key,
        size: key.length + raw.length,
        at: snapshotWrittenAt(raw),
      })
    }
    snapshots.sort((a, b) => b.at - a.at)
    let total = 0
    for (const snapshot of snapshots) {
      total += snapshot.size
      if (
        now - snapshot.at > PREVIEW_STATE_MAX_AGE_MS ||
        total > PREVIEW_STATE_MAX_CHARS
      ) {
        removed.push(snapshot.key)
        total -= snapshot.size
      }
    }
    for (const key of removed) store.removeItem(key)
  } catch {
    // Storage blocked or refusing: nothing to prune, and nothing a preview
    // click should fail over.
  }
  return removed
}
