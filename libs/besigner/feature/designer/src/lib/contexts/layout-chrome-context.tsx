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

import type * as Aglyn from '@aglyn/aglyn'
import {
  aglyn,
  applyLayoutProps,
  CanvasManager,
  composeReusableComponentNodes,
  NODE_ROOT_ID,
} from '@aglyn/aglyn'
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
 *
 * `reusableDefinitions` (host components keyed by id) grafts the layout's
 * reusable instances before the canvas loads (AGL-1217). The placeholder an
 * unexpanded instance renders is the EDITOR's UX — it names what you would
 * be selecting in the document that owns it — but chrome is not editable
 * from here, so on this canvas it is just a dashed grey box where the site
 * shows the nav. Grafting into the chrome canvas alone keeps the layout's
 * own editor untouched, and chrome stays as locked as it was: expansion
 * only adds nodes to a canvas the viewport already renders non-interactive.
 * Omitted or undefined, the graft no-ops and chrome renders as it did.
 */
export function useLayoutChromeCanvas(
  layoutNodes: Aglyn.ProcessableNodes | undefined,
  reusableDefinitions?: Record<string, Aglyn.ReusableComponentTree>,
  /**
   * The layout's declared properties and this screen's values for them
   * (AGL-2893), applied before anything is grafted — the composition the
   * published page runs, so the chrome shows the banner, copy and choices
   * this screen will publish with.
   */
  layoutProps?: {
    props?: Aglyn.ReusableComponentProp[] | null
    values?: Record<string, unknown> | null
  },
): Aglyn.CanvasManager | undefined {
  const declared = layoutProps?.props
  const values = layoutProps?.values
  return useMemo(() => {
    if (!layoutNodes) return undefined
    // Separate store instance so edits, history, and persistence stay on the
    // global screen canvas — but backed by the real app: node getters reach
    // through store.aglyn.components to resolve component schemas.
    const canvas = new CanvasManager(aglyn)
    // Cast as the tenant pipeline and Preview do: the canvas's `NodeSchema`
    // makes `componentId` optional, the graft's `AglynNodeSchema` requires
    // it, and neither side is wrong about its own half of the trip.
    const nodes = {
      ...(composeReusableComponentNodes(
        (applyLayoutProps(layoutNodes as any, declared, values) ??
          layoutNodes) as any,
        reusableDefinitions as any,
      ) as Record<string, Aglyn.NodeSchema>),
    }
    // Early seeds stored roots without $id, letting the canvas assign a
    // random one — pin the root to its canonical id before loading.
    if (nodes[NODE_ROOT_ID]) {
      nodes[NODE_ROOT_ID] = {
        ...nodes[NODE_ROOT_ID],
        $id: NODE_ROOT_ID,
      }
    }
    canvas.setNodes(canvas.processNodesToDenormalized(nodes))
    return canvas
  }, [layoutNodes, reusableDefinitions, declared, values])
}

export default LayoutChromeContext
