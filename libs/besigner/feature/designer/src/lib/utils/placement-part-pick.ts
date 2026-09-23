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

import { STYLE_OVERRIDES_ROOT_KEY } from '@aglyn/aglyn'
import { action, observable } from 'mobx'

/**
 * The part of a placement the author last clicked ON THE CANVAS (AGL-3288).
 *
 * A placement's inner elements are drawn inert — every click lands on the
 * placement itself — so the canvas cannot select them. What it can do is say
 * which of them was under the pointer, and the Styles and Attributes tabs
 * aim their "Which part?" picker there.
 *
 * `seq` orders the canvas's picks against a panel's own: each panel remembers
 * the `seq` it last saw, so a newer canvas click moves the picker and a
 * later choice in the menu is not snapped back by an older click.
 */
export interface PlacementPartPick {
  /** The placement node the click landed on. */
  nodeId?: string
  /** The override key of the part under the pointer. */
  key: string
  /** Increments on every canvas pick. */
  seq: number
}

const state = observable<PlacementPartPick>({
  nodeId: undefined,
  key: STYLE_OVERRIDES_ROOT_KEY,
  seq: 0,
})

/** The latest canvas pick (observable — read it inside an `observer`). */
export function getPlacementPartPick(): PlacementPartPick {
  return state
}

/** Records a canvas click on one part of a placement. */
export const pickPlacementPart = action((nodeId: string, key: string) => {
  state.nodeId = nodeId
  state.key = key || STYLE_OVERRIDES_ROOT_KEY
  state.seq += 1
})

/** Forgets the last canvas pick — for a fresh document, and for specs. */
export const resetPlacementPartPick = action(() => {
  state.nodeId = undefined
  state.key = STYLE_OVERRIDES_ROOT_KEY
})

/**
 * The part a panel should edit: a canvas click newer than the panel's own
 * choice wins, then the panel's choice for this node, then the whole
 * placement.
 */
export function resolvePickedPart(
  nodeId: string | undefined,
  local: { nodeId?: string; key: string; seq: number },
  canvasPick: PlacementPartPick = state,
): string {
  if (!nodeId) return STYLE_OVERRIDES_ROOT_KEY
  if (canvasPick.nodeId === nodeId && canvasPick.seq > local.seq) {
    return canvasPick.key
  }
  return local.nodeId === nodeId ? local.key : STYLE_OVERRIDES_ROOT_KEY
}
