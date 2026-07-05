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

import type { NodesMap } from '@aglyn/aglyn'

export interface PreviewStateIds {
  hostId: string
  screenId: string
  versionId: string
}

export interface PreviewState {
  nodes: NodesMap
  updatedAt: number
}

export function previewStateKey(ids: PreviewStateIds): string {
  return `aglyn:preview:${ids.hostId}:${ids.screenId}:${ids.versionId}`
}

export function previewWindowName(ids: PreviewStateIds): string {
  return `aglyn-preview-${ids.hostId}-${ids.screenId}-${ids.versionId}`
}

export function writePreviewState(ids: PreviewStateIds, nodes: NodesMap): void {
  const state: PreviewState = { nodes, updatedAt: Date.now() }
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
