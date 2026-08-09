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
 * Where the Styles panel's edits land for the selected node (AGL-1306).
 *
 * A plain node's edits read and write `node.sx`, exactly as they always
 * have. A reusable-component INSTANCE's edits read and write the root
 * slice of `node.styleOverrides` instead — the panel behaves like it does
 * on a fresh plain node (empty until this instance overrides something),
 * and the canvas/Preview/tenant render the override merged over the
 * component root via `composeReusableComponentNodes`. Mutating the
 * component itself from a placing document is exactly what this layer
 * exists to avoid.
 *
 * `sx` is a GETTER so observer components track the underlying MobX state
 * at read time; a snapshot captured when the target was built would go
 * stale after the first write.
 */
export interface NodeStyleTarget {
  /** The sx record edits read from and write to (live view). */
  readonly sx: Record<string, any> | undefined
  /** True when edits land in the instance's root override layer. */
  readonly isInstanceOverride: boolean
  /** Replaces the target sx wholesale (MobX action inside). */
  setSx(next: Record<string, any> | undefined): void
}

/** The style target for a selected node — see {@link NodeStyleTarget}. */
export function getNodeStyleTarget(
  node: Aglyn.NodeSchema<any> | null | undefined,
): NodeStyleTarget {
  const isInstance =
    node?.componentId === Aglyn.REUSABLE_INSTANCE_COMPONENT_ID
  if (!node || !isInstance) {
    return {
      isInstanceOverride: false,
      get sx() {
        return node?.sx as Record<string, any> | undefined
      },
      setSx: action((next: Record<string, any> | undefined) => {
        if (!node) return
        node.sx = (next ?? {}) as any
      }),
    }
  }
  return {
    isInstanceOverride: true,
    get sx() {
      return (
        node.styleOverrides as Record<string, any> | undefined
      )?.[Aglyn.STYLE_OVERRIDES_ROOT_KEY]
    },
    setSx: action((next: Record<string, any> | undefined) => {
      const overrides: Record<string, any> = {
        ...toJS(node.styleOverrides ?? {}),
      }
      if (next && Object.keys(next).length > 0) {
        overrides[Aglyn.STYLE_OVERRIDES_ROOT_KEY] = next
      } else {
        // An emptied override is REMOVED, not stored as `{}`: the panel's
        // override badge and the graft's "has an override" check must both
        // read a cleared instance as clean.
        delete overrides[Aglyn.STYLE_OVERRIDES_ROOT_KEY]
      }
      node.styleOverrides =
        Object.keys(overrides).length > 0 ? overrides : undefined
    }),
  }
}

export default getNodeStyleTarget
