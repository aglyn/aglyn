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

import { createContext } from 'react'
import type { NodeSchema } from '../aglyn'

/**
 * The designer's assistant seam (AGL-2939): the callbacks a plugin's app
 * provider offers the designer's toolbar and attributes panel, and the
 * designer renders a control only where the callback exists. The seam sits
 * in core because the two sides may not import each other — the designer
 * stays free of any plugin, and a plugin may not reach into the designer's
 * React surface — so both read one context that neither owns.
 *
 * A client-only context like the others in `contexts.ts`: it calls
 * `createContext` at module scope, so it is reachable from the full
 * `@aglyn/aglyn` barrel and never from `@aglyn/aglyn/server` (AGL-405).
 */
export interface DesignerAssistContextValue {
  /**
   * Rewrites a text-editable element's copy (AGL-89): opens the provider's
   * instruction dialog for the node.
   */
  onRewrite?: (node: NodeSchema<any>) => void
  /**
   * Generates a section (AGL-169): opens the provider's prompt dialog and
   * grafts the proposed subtree into the canvas root.
   */
  onGenerateSection?: () => void
}

export const DesignerAssistContext = createContext<DesignerAssistContextValue>({})
DesignerAssistContext.displayName = 'DesignerAssistContext'
