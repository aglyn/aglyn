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

import * as Aglyn from '@aglyn/aglyn'
import { useCallback } from 'react'
import {
  type PreviewStateIds,
  previewWindowName,
  writePreviewState,
} from '../constants/preview-state'

export interface UseOpenPreviewOptions {
  /** Identifies the snapshot; null while the ids are still resolving. */
  ids: PreviewStateIds | null
  /** Console URL of the matching preview route. */
  href?: string
  /** Host theme, so the preview styles like the live site. */
  hostTheme?: Aglyn.AglynHostTheme
  /**
   * Nodes to snapshot. Defaults to the canvas as it stands, which is right
   * for a component or template; a screen or layout overrides it to compose
   * the surrounding layout chain first.
   */
  compose?: () => Aglyn.NodesMap | Promise<Aglyn.NodesMap>
}

/**
 * Snapshot the current besigner draft and open its preview tab (AGL-1203).
 *
 * The snapshot goes through `localStorage` rather than a deployment, so
 * preview works against a local dev server. Reusing one window name per
 * document means clicking Preview again refreshes the tab you already have
 * open instead of piling up new ones — and the preview page listens for the
 * `storage` event, so it re-renders even when the tab is already focused.
 */
export function useOpenPreview(options: UseOpenPreviewOptions) {
  const { ids, href, hostTheme, compose } = options
  const hostId = ids?.hostId
  const kind = ids?.kind
  const docId = ids?.docId
  const versionId = ids?.versionId

  return useCallback(async () => {
    if (!hostId || !kind || !docId || !href) return
    const resolved: PreviewStateIds = { hostId, kind, docId, versionId }
    const nodes = compose
      ? await compose()
      : (Aglyn.canvas.toJSON().nodes as Aglyn.NodesMap)
    writePreviewState(resolved, nodes, hostTheme)
    window.open(href, previewWindowName(resolved))
  }, [hostId, kind, docId, versionId, href, hostTheme, compose])
}

export default useOpenPreview
