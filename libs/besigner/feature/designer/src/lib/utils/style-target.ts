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
import { action, toJS } from 'mobx'

/**
 * Where the Styles panel's edits land for the selected node (AGL-1306,
 * AGL-1332).
 *
 * A plain node's edits read and write `node.sx`, exactly as they always
 * have. A reusable-component INSTANCE's edits read and write one slice of
 * `node.styleOverrides` instead — the root slice by default, or the slice
 * keyed by a DEFINITION-internal node id when the author has picked a leaf
 * inside the component. Either way the panel behaves like it does on a
 * fresh plain node (empty until this instance overrides something), and
 * the canvas/Preview/tenant render the override merged over the matching
 * component node via `composeReusableComponentNodes`. Mutating the
 * component itself from a placing document is exactly what this layer
 * exists to avoid — a leaf target styles the instance's copy of that leaf,
 * and never unlocks the component's content, which stays the component's.
 *
 * `sx` is a GETTER so observer components track the underlying MobX state
 * at read time; a snapshot captured when the target was built would go
 * stale after the first write.
 */
export interface NodeStyleTarget {
  /** The sx record edits read from and write to (live view). */
  readonly sx: Record<string, any> | undefined
  /** True when edits land in one of the instance's override slices. */
  readonly isInstanceOverride: boolean
  /**
   * The `styleOverrides` key being edited — `root`, or a definition-internal
   * node id. Empty string for a plain node, which has no override layer.
   */
  readonly overrideKey: string
  /** True when the target is a leaf inside the component, not its root. */
  readonly isLeafOverride: boolean
  /** Replaces the target sx wholesale (MobX action inside). */
  setSx(next: Record<string, any> | undefined): void
}

/**
 * The style target for a selected node — see {@link NodeStyleTarget}.
 *
 * `overrideKey` selects WHICH slice of an instance's overrides is edited;
 * it is ignored for a plain node. A falsy key falls back to the root, so a
 * caller that has not resolved a definition yet still edits something real
 * rather than writing an `undefined`-keyed slice no renderer reads.
 */
export function getNodeStyleTarget(
  node: Aglyn.NodeSchema<any> | null | undefined,
  overrideKey?: string | null,
): NodeStyleTarget {
  const isInstance =
    node?.componentId === Aglyn.REUSABLE_INSTANCE_COMPONENT_ID
  if (!node || !isInstance) {
    return {
      isInstanceOverride: false,
      overrideKey: '',
      isLeafOverride: false,
      get sx() {
        return node?.sx as Record<string, any> | undefined
      },
      setSx: action((next: Record<string, any> | undefined) => {
        if (!node) return
        node.sx = (next ?? {}) as any
      }),
    }
  }
  const key = overrideKey || Aglyn.STYLE_OVERRIDES_ROOT_KEY
  return {
    isInstanceOverride: true,
    overrideKey: key,
    isLeafOverride: key !== Aglyn.STYLE_OVERRIDES_ROOT_KEY,
    get sx() {
      return (node.styleOverrides as Record<string, any> | undefined)?.[key]
    },
    setSx: action((next: Record<string, any> | undefined) => {
      const overrides: Record<string, any> = {
        ...toJS(node.styleOverrides ?? {}),
      }
      if (next && Object.keys(next).length > 0) {
        overrides[key] = next
      } else {
        // An emptied override is REMOVED, not stored as `{}`: the panel's
        // override badge and the graft's "has an override" check must both
        // read a cleared instance as clean. Only THIS slice goes — the
        // instance's other targets keep theirs.
        delete overrides[key]
      }
      node.styleOverrides =
        Object.keys(overrides).length > 0 ? overrides : undefined
    }),
  }
}

export default getNodeStyleTarget
