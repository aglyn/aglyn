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

import { createContext, useContext, type ReactNode } from 'react'

/**
 * A section the host app appends to the Attributes panel, under the
 * selected element's own fields (AGL-2940).
 *
 * The designer stays free of console imports the way `AiAssistContext`
 * keeps it network-agnostic: the console supplies the node — its plugin
 * widget slot, rendered with the shell's own gates — and the panel draws
 * whatever arrives. Nothing here knows what a plugin is.
 */
export const BesignerInspectorExtrasContext = createContext<ReactNode>(null)
BesignerInspectorExtrasContext.displayName = 'BesignerInspectorExtrasContext'

/** The host-supplied section, or `null` when the host supplied nothing. */
export function useBesignerInspectorExtras(): ReactNode {
  return useContext(BesignerInspectorExtrasContext)
}

export default BesignerInspectorExtrasContext
