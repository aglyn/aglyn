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

import type { AglynHostTheme, NodesMap } from '@aglyn/aglyn'

/**
 * Which kind of besigner document a preview snapshot came from (AGL-1204).
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
  return `aglyn:preview:${ids.kind}:${ids.hostId}:${ids.docId}:${version}`
}

export function previewWindowName(ids: PreviewStateIds): string {
  const version = ids.versionId ?? 'current'
  return `aglyn-preview-${ids.kind}-${ids.hostId}-${ids.docId}-${version}`
}

export function writePreviewState(
  ids: PreviewStateIds,
  nodes: NodesMap,
  theme?: AglynHostTheme,
): void {
  const state: PreviewState = { nodes, theme, updatedAt: Date.now() }
  window.localStorage.setItem(previewStateKey(ids), JSON.stringify(state))
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
