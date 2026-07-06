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
'use client'

import * as Aglyn from '@aglyn/aglyn'
import { createContext, useContext, useMemo } from 'react'

export type LayoutChromeContextValue = {
  /**
   * Read-only canvas holding the bound layout's nodes. The viewport renders
   * it as non-interactive chrome around the editable screen canvas; absent,
   * the screen renders bare (today's behavior).
   */
  chromeCanvas?: Aglyn.CanvasManager
}

export const LayoutChromeContext = createContext<LayoutChromeContextValue>({})
LayoutChromeContext.displayName = 'LayoutChromeContext'

export function useLayoutChromeContext() {
  return useContext(LayoutChromeContext)
}

/**
 * Builds the read-only chrome canvas from a layout version's node map.
 * Returns undefined without nodes so unbound screens skip chrome entirely.
 */
export function useLayoutChromeCanvas(
  layoutNodes: Aglyn.ProcessableNodes | undefined,
): Aglyn.CanvasManager | undefined {
  return useMemo(() => {
    if (!layoutNodes) return undefined
    // Separate store instance so edits, history, and persistence stay on the
    // global screen canvas — but backed by the real app: node getters reach
    // through store.aglyn.components to resolve component schemas.
    const canvas = new Aglyn.CanvasManager(Aglyn.aglyn)
    const nodes = { ...(layoutNodes as Record<string, Aglyn.NodeSchema>) }
    // Early seeds stored roots without $id, letting the canvas assign a
    // random one — pin the root to its canonical id before loading.
    if (nodes[Aglyn.NODE_ROOT_ID]) {
      nodes[Aglyn.NODE_ROOT_ID] = {
        ...nodes[Aglyn.NODE_ROOT_ID],
        $id: Aglyn.NODE_ROOT_ID,
      }
    }
    canvas.setNodes(canvas.processNodesToDenormalized(nodes))
    return canvas
  }, [layoutNodes])
}

export default LayoutChromeContext
