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
export type PreviewKind = 'screen' | 'component' | 'layout' | 'template'

export interface PreviewStateIds {
  hostId: string
  kind: PreviewKind
  /** Screen / component / layout / template id. */
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
  return writeLocalStorageWithBudget({
    key: previewStateKey(ids),
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
