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

import type { NodeSchema } from '@aglyn/aglyn'
import { createContext, useContext, type ReactNode } from 'react'

/** What the Attributes panel knows when it draws the host's section. */
export interface BesignerInspected {
  /** The selected element, as the panel resolved it. */
  node: NodeSchema<any>
  /**
   * Whether this document's editor may change the element in place
   * (AGL-2908): the panel's own rule for the actions it offers under the
   * element's fields — Save as reusable component, Detach from component —
   * which the canvas root and locked layout chrome fail.
   *
   * The panel answers it because only the panel can. A host section is
   * handed a node, not the editor: it has no canvas, no drag manager and no
   * business importing either to work the rule out for itself. A section
   * that would change the element reads this; one that only reports on it
   * ignores it.
   */
  editable: boolean
}

/**
 * The host's section: a node drawn as it is, or a function that draws one
 * for the selected element (AGL-2984).
 */
export type BesignerInspectorExtras =
  | ReactNode
  | ((inspected: BesignerInspected) => ReactNode)

/**
 * A section the host app appends to the Attributes panel, under the
 * selected element's own fields (AGL-2940).
 *
 * The designer stays free of console imports: the console supplies the
 * section — its plugin widget slot, rendered with the shell's own gates, and
 * handed the selection when it is a function — and the panel draws whatever
 * arrives. Nothing here knows what a plugin is.
 */
export const BesignerInspectorExtrasContext = createContext<BesignerInspectorExtras>(null)
BesignerInspectorExtrasContext.displayName = 'BesignerInspectorExtrasContext'

/** The host-supplied section, or `null` when the host supplied nothing. */
export function useBesignerInspectorExtras(): BesignerInspectorExtras {
  return useContext(BesignerInspectorExtrasContext)
}

/** The section to draw for a selection: a function's answer for it, or the node as given. */
export function inspectorExtrasFor(
  extras: BesignerInspectorExtras,
  inspected: BesignerInspected,
): ReactNode {
  return typeof extras === 'function' ? extras(inspected) : extras
}

export default BesignerInspectorExtrasContext
