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
